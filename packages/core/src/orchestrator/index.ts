import path from 'path';
import fs from 'fs/promises';
import { prisma } from '@zyphon/db';
import { 
  AgentPlan, 
  TaskType, 
  TASK_TIMEOUT_MS, 
  TaskStatus, 
  StepStatus, 
  classifyIntent,
  ExecutionPlan,
  ExecutionContext,
  StepResult,
  DEFAULT_CONSTRAINTS,
  TaskConstraints,
  PlanStep,
} from '@zyphon/shared';
import { PlannerAgent } from '../agents/planner.js';
import { ExecutorAgent } from '../agents/executor.js';
import { CriticAgent } from '../agents/critic.js';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'orchestrator' });

interface OrchestratorConfig {
  workspaceRoot: string;
  maxRetries: number;
  timeout: number;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  workspaceRoot: process.env['WORKSPACE_ROOT'] || (process.env['VERCEL'] ? '/tmp/workspaces' : './workspaces'),
  maxRetries: 1,
  timeout: TASK_TIMEOUT_MS,
};

export class Orchestrator {
  private planner: PlannerAgent;
  private executor: ExecutorAgent;
  private critic: CriticAgent;
  private config: OrchestratorConfig;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.planner = new PlannerAgent();
    this.executor = new ExecutorAgent();
    this.critic = new CriticAgent();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run a task with the new Manus-like brain.
   * Supports composite goals with multi-step plans.
   */
  async runTask(taskId: string): Promise<void> {
    const startTime = Date.now();
    logger.info({ taskId }, 'Starting task execution');

    try {
      // Load task from database
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { project: { include: { org: true } } },
      });

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      if (task.status !== 'QUEUED') {
        throw new Error(`Task is not in QUEUED state: ${task.status}`);
      }

      // Initialize workspace
      const workspacePath = await this.initializeWorkspace(taskId);

      // Update task status to RUNNING
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'RUNNING',
          startedAt: new Date(),
          workspacePath,
        },
      });

      // Classify intent to determine routing
      const intent = classifyIntent(task.goal);
      logger.info({
        taskId,
        expectedOutput: intent.expectedOutput,
        isComposite: intent.isComposite,
        inferredOutputs: intent.inferredOutputs,
      }, 'Task intent classified');

      // PHASE 1: Planning
      logger.info({ taskId }, 'Phase 1: Planning');
      const plan = await this.planner.createPlan({
        taskId,
        goal: task.goal,
        context: task.context || undefined,
        type: task.type as TaskType,
      });

      // Save plan to workspace
      await this.savePlan(workspacePath, plan);

      // Create step records in database
      await this.createStepRecords(taskId, plan);

      // Update task status
      await prisma.task.update({
        where: { id: taskId },
        data: { status: 'PLANNED' },
      });

      // PHASE 2: Execution
      logger.info({ taskId, stepCount: plan.steps.length, expectedOutputs: plan.expectedOutputs }, 'Phase 2: Execution');

      // Create execution context
      const context: ExecutionContext = {
        taskId,
        workspacePath,
        goal: task.goal,
        constraints: plan.constraints,
        previousOutputs: new Map(),
        stepResults: new Map(),
        startTime,
        stepCount: 0,
      };

      let allStepsSucceeded = true;
      const results: Array<{ stepId: string; success: boolean; output: unknown }> = [];

      // Execute steps in order, respecting dependencies
      for (const step of plan.steps) {
        // Check dependencies
        const canExecute = this.canExecuteStep(step, context);

        if (!canExecute) {
          logger.warn({ taskId, stepId: step.id }, 'Skipping step due to failed dependency');
          await this.updateStepStatusById(taskId, step.id, 'SKIPPED');
          continue;
        }

        // Execute step
        await this.updateStepStatusById(taskId, step.id, 'RUNNING');
        
        const stepResult = await this.executor.executePlanStep(step, context);

        // PHASE 3: Per-step critique (for important steps)
        if (this.shouldCritiqueStep(step)) {
          const legacyStep = {
            index: plan.steps.indexOf(step),
            name: step.id,
            description: step.outputs?.notes || '',
            tool: this.mapToolToLegacy(step.tool),
            input: step.input,
            dependsOn: [],
          };

          const evaluation = await this.critic.evaluate({
            step: legacyStep,
            result: stepResult.result,
            goal: task.goal,
          });

          // Handle retry if needed
          if (!evaluation.passed && await this.critic.shouldRetry(evaluation) && stepResult.retryCount === 0) {
            logger.info({ taskId, stepId: step.id }, 'Retrying step based on critic evaluation');
            const retryResult = await this.executor.executePlanStep(step, context);
            stepResult.result = retryResult.result;
            stepResult.status = retryResult.status;
          }
        }

        // Update step record in DB
        await this.updateStepRecordById(taskId, step.id, stepResult);

        results.push({
          stepId: step.id,
          success: stepResult.status === 'COMPLETED',
          output: stepResult.result.output,
        });

        if (stepResult.status !== 'COMPLETED') {
          allStepsSucceeded = false;
          // Continue to next steps that don't depend on this one
        }

        // Check timeout
        if (Date.now() - startTime > this.config.timeout) {
          throw new Error('Task execution timeout');
        }
      }

      // PHASE 4: Final Verification
      logger.info({ taskId }, 'Phase 4: Final Verification');
      
      const verification = await this.critic.verifyPlanExecution({
        goal: task.goal,
        expectedOutputs: plan.expectedOutputs,
        stepResults: Array.from(context.stepResults.values()),
        workspacePath,
      });

      // Handle retry for missing artifacts
      if (!verification.passed && verification.canRetry && verification.retrySteps) {
        logger.info({ taskId, retrySteps: verification.retrySteps }, 'Retrying failed steps');
        
        for (const stepId of verification.retrySteps) {
          const step = plan.steps.find((s: PlanStep) => s.id === stepId);
          if (step) {
            const retryResult = await this.executor.executePlanStep(step, context);
            await this.updateStepRecordById(taskId, stepId, retryResult);
            
            // Update results
            const existingIdx = results.findIndex(r => r.stepId === stepId);
            if (existingIdx >= 0) {
              results[existingIdx] = {
                stepId,
                success: retryResult.status === 'COMPLETED',
                output: retryResult.result.output,
              };
            }
          }
        }

        // Re-verify after retries
        const reverification = await this.critic.verifyPlanExecution({
          goal: task.goal,
          expectedOutputs: plan.expectedOutputs,
          stepResults: Array.from(context.stepResults.values()),
          workspacePath,
        });
        
        allStepsSucceeded = reverification.passed;
      } else {
        allStepsSucceeded = verification.passed;
      }

      // Finalize task
      const finalStatus: TaskStatus = allStepsSucceeded ? 'SUCCEEDED' : 'FAILED';
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          result: { 
            steps: results,
            expectedOutputs: plan.expectedOutputs,
            verification: {
              passed: verification.passed,
              missingArtifacts: verification.missingArtifacts,
              failedSteps: verification.failedSteps,
            },
          },
          error: allStepsSucceeded ? null : verification.suggestions?.join('; '),
        },
      });

      logger.info({ 
        taskId, 
        status: finalStatus, 
        duration: Date.now() - startTime,
        verification: {
          passed: verification.passed,
          missingArtifacts: verification.missingArtifacts,
        },
      }, 'Task completed');

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ taskId, error: message }, 'Task execution failed');

      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: message,
        },
      });

      throw error;
    }
  }

  /**
   * Check if a step can be executed based on dependencies.
   */
  private canExecuteStep(step: PlanStep, context: ExecutionContext): boolean {
    if (!step.dependsOn || step.dependsOn.length === 0) {
      return true;
    }

    return step.dependsOn.every(depId => {
      const depResult = context.stepResults.get(depId);
      return depResult && depResult.status === 'COMPLETED';
    });
  }

  /**
   * Determine if a step should be critiqued.
   * Skip critique for simple FS and VERIFY steps.
   */
  private shouldCritiqueStep(step: PlanStep): boolean {
    // Always critique IMAGE and CODE_GEN steps
    if (step.type === 'IMAGE_GEN' || step.type === 'CODE_GEN') {
      return true;
    }
    // Skip critique for simple file operations and verification
    if (step.type === 'FS_WRITE' || step.type === 'FS_READ' || step.type === 'VERIFY') {
      return false;
    }
    // Default: critique
    return true;
  }

  /**
   * Map tool type to legacy format for critic compatibility.
   */
  private mapToolToLegacy(tool: string): 'LLM' | 'IMAGE' | 'FILE' | 'SHELL' {
    const mapping: Record<string, 'LLM' | 'IMAGE' | 'FILE' | 'SHELL'> = {
      'LLM': 'LLM',
      'IMAGE': 'IMAGE',
      'FS': 'FILE',
      'FILE': 'FILE',
      'TERMINAL': 'SHELL',
      'SHELL': 'SHELL',
      'BROWSER': 'SHELL',
      'WEB': 'LLM',
      'NONE': 'LLM',
    };
    return mapping[tool] || 'LLM';
  }

  private async initializeWorkspace(taskId: string): Promise<string> {
    const workspacePath = path.join(this.config.workspaceRoot, taskId);

    await fs.mkdir(path.join(workspacePath, 'outputs', 'images'), { recursive: true });
    await fs.mkdir(path.join(workspacePath, 'outputs', 'browser'), { recursive: true });
    await fs.mkdir(path.join(workspacePath, 'outputs', 'code'), { recursive: true });
    await fs.mkdir(path.join(workspacePath, 'logs', 'terminal'), { recursive: true });
    await fs.mkdir(path.join(workspacePath, 'logs', 'browser'), { recursive: true });

    // Create context file
    await fs.writeFile(
      path.join(workspacePath, 'context.json'),
      JSON.stringify({ taskId, createdAt: new Date().toISOString() }, null, 2)
    );

    return workspacePath;
  }

  private async savePlan(workspacePath: string, plan: ExecutionPlan): Promise<void> {
    await fs.writeFile(
      path.join(workspacePath, 'plan.json'),
      JSON.stringify(plan, null, 2)
    );
  }

  private async createStepRecords(taskId: string, plan: ExecutionPlan): Promise<void> {
    await prisma.taskStep.createMany({
      data: plan.steps.map((step, idx) => ({
        taskId,
        index: idx,
        name: step.id,
        description: step.outputs?.notes || `${step.type} using ${step.tool}`,
        tool: this.mapToolToLegacy(step.tool),
        input: step.input as object,
        status: 'PENDING',
      })),
    });
  }

  private async updateStepStatusById(taskId: string, stepId: string, status: StepStatus): Promise<void> {
    await prisma.taskStep.updateMany({
      where: { taskId, name: stepId },
      data: {
        status,
        ...(status === 'RUNNING' ? { startedAt: new Date() } : {}),
        ...(status === 'COMPLETED' || status === 'FAILED' || status === 'SKIPPED' ? { completedAt: new Date() } : {}),
      },
    });
  }

  private async updateStepRecordById(
    taskId: string,
    stepId: string,
    result: StepResult
  ): Promise<void> {
    await prisma.taskStep.updateMany({
      where: { taskId, name: stepId },
      data: {
        status: result.status,
        output: result.result.output as object || null,
        error: result.result.error || null,
        completedAt: new Date(),
      },
    });

    // Create artifact records
    if (result.result.artifacts && Array.isArray(result.result.artifacts)) {
      for (const artifact of result.result.artifacts) {
        const a = artifact as { name: string; path: string; type: string; size: number };
        const step = await prisma.taskStep.findFirst({
          where: { taskId, name: stepId },
        });

        await prisma.artifact.create({
          data: {
            taskId,
            stepId: step?.id,
            name: a.name,
            type: a.type,
            path: a.path,
            size: a.size,
          },
        });
      }
    }
  }

  // Legacy support methods for backward compatibility
  private async updateStepStatus(taskId: string, index: number, status: StepStatus): Promise<void> {
    await prisma.taskStep.updateMany({
      where: { taskId, index },
      data: {
        status,
        ...(status === 'RUNNING' ? { startedAt: new Date() } : {}),
        ...(status === 'COMPLETED' || status === 'FAILED' || status === 'SKIPPED' ? { completedAt: new Date() } : {}),
      },
    });
  }

  private async updateStepRecord(
    taskId: string,
    index: number,
    result: { status: StepStatus; result: { output: unknown; error?: string; artifacts?: unknown[] } }
  ): Promise<void> {
    await prisma.taskStep.updateMany({
      where: { taskId, index },
      data: {
        status: result.status,
        output: result.result.output as object || null,
        error: result.result.error || null,
        completedAt: new Date(),
      },
    });

    if (result.result.artifacts && Array.isArray(result.result.artifacts)) {
      for (const artifact of result.result.artifacts) {
        const a = artifact as { name: string; path: string; type: string; size: number };
        const step = await prisma.taskStep.findFirst({
          where: { taskId, index },
        });

        await prisma.artifact.create({
          data: {
            taskId,
            stepId: step?.id,
            name: a.name,
            type: a.type,
            path: a.path,
            size: a.size,
          },
        });
      }
    }
  }
}

export const orchestrator = new Orchestrator();
