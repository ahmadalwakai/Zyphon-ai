/**
 * Agent Pipeline — Orchestrates the full planner → coder → executor → critic → packager flow.
 * This is the main entry point for running a task end-to-end.
 */

import { Sandbox } from '@zyphon/executor';
import { PlannerAgent, type PlanStep } from './agents/planner.js';
import { CoderAgent } from './agents/coder.js';
import { ExecutorAgent } from './agents/executor-agent.js';
import { CriticAgent } from './agents/critic.js';
import { PackagerAgent } from './agents/packager-agent.js';
import { LLMRouter } from './llm/router.js';
import type { GroqStreamCallback } from './llm/groq-client.js';
import { TaskStore, type TaskLog } from './store.js';

export interface PipelineOptions {
  taskId: string;
  goal: string;
  maxRetries?: number;
  timeoutMs?: number;
  groqApiKey?: string;
  groqModel?: string;
  onEvent?: GroqStreamCallback;
}

export interface PipelineResult {
  success: boolean;
  taskId: string;
  fileCount: number;
  downloadUrl?: string;
  zipPath?: string;
  error?: string;
  durationMs: number;
}

export class AgentPipeline {
  private planner: PlannerAgent;
  private coder: CoderAgent;
  private executor: ExecutorAgent;
  private critic: CriticAgent;
  private packager: PackagerAgent;
  private llm: LLMRouter;

  constructor(groqApiKey?: string, groqModel?: string) {
    this.llm = new LLMRouter({
      groqApiKey: groqApiKey,
      groqModel: groqModel ?? 'llama-3.3-70b-versatile',
    });

    this.planner = new PlannerAgent(this.llm);
    this.coder = new CoderAgent(this.llm);
    this.executor = new ExecutorAgent();
    this.critic = new CriticAgent(this.llm);
    this.packager = new PackagerAgent();
  }

  /**
   * Run the full pipeline for a given goal.
   */
  async run(options: PipelineOptions): Promise<PipelineResult> {
    const { taskId, goal, maxRetries = 3, onEvent } = options;
    const startTime = Date.now();

    // Create sandbox
    const sandbox = new Sandbox({ taskId, timeoutMs: options.timeoutMs ?? 55_000 });

    // Helper to log both to store and SSE
    const log = (stage: TaskLog['stage'], message: string) => {
      TaskStore.addLog(taskId, stage, message);
      onEvent?.({ type: 'token', content: message + '\n', stage });
    };

    try {
      // ===== STAGE 1: PLANNING =====
      TaskStore.update(taskId, { status: 'planning' });
      log('planning', `🧠 Planning project: "${goal}"`);

      let steps: PlanStep[];
      try {
        steps = await this.planner.plan(goal, onEvent);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Planning failed';
        throw new Error(`Planning failed: ${msg}`);
      }

      TaskStore.update(taskId, { totalSteps: steps.length });
      log('planning', `📋 Plan created: ${steps.length} steps`);
      for (const step of steps) {
        log('planning', `  ${step.step}. [${step.type}] ${step.description}`);
      }

      // ===== STAGE 2: CODING =====
      TaskStore.update(taskId, { status: 'coding' });
      log('coding', '\n✍️ Generating code...');

      const fileSteps = steps.filter(s => s.type === 'file' || s.type === 'config');
      const commandSteps = steps.filter(s => s.type === 'dependency' || s.type === 'command' || s.type === 'test');

      for (let i = 0; i < fileSteps.length; i++) {
        const step = fileSteps[i]!;
        TaskStore.update(taskId, { currentStep: step.step });
        log('coding', `\n📝 Step ${step.step}: ${step.description}`);

        try {
          const result = await this.coder.code(step, sandbox, goal, steps, onEvent);
          log('coding', `  ✓ Wrote ${result.filePath} (${result.content.length} bytes)`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Code generation failed';
          log('error', `  ✗ Failed to generate ${step.filePath}: ${msg}`);
          // Continue with other files even if one fails
        }

        // Check timeout
        if (sandbox.isTimedOut()) {
          throw new Error('Sandbox timed out during code generation');
        }
      }

      // ===== STAGE 3: EXECUTION =====
      if (commandSteps.length > 0) {
        TaskStore.update(taskId, { status: 'executing' });
        log('executing', '\n⚡ Executing commands...');

        for (const step of commandSteps) {
          TaskStore.update(taskId, { currentStep: step.step });
          log('executing', `\n🔄 Step ${step.step}: ${step.description}`);

          try {
            const result = await this.executor.execute(step, sandbox, onEvent);

            if (!result.success) {
              // ===== STAGE 4: CRITIC / FIX =====
              TaskStore.update(taskId, { status: 'fixing' });
              log('fixing', `\n🔍 Command failed — launching critic...`);

              const fixResult = await this.critic.diagnoseAndFix(
                result.stderr || result.stdout,
                sandbox,
                onEvent,
                maxRetries
              );

              if (!fixResult.fixed) {
                log('error', `  ✗ Could not fix after ${fixResult.attempts} attempts`);
                log('error', `  Last error: ${fixResult.lastError?.substring(0, 300)}`);
                // Continue with remaining steps instead of aborting
              } else {
                log('fixing', `  ✓ Fixed on attempt ${fixResult.attempts}`);
              }

              TaskStore.update(taskId, { status: 'executing' });
            } else {
              log('executing', `  ✓ Command succeeded (${result.durationMs}ms)`);
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Execution failed';
            log('error', `  ✗ Execution error: ${msg}`);
          }

          // Check timeout
          if (sandbox.isTimedOut()) {
            throw new Error('Sandbox timed out during execution');
          }
        }
      }

      // ===== STAGE 5: PACKAGING =====
      TaskStore.update(taskId, { status: 'packaging' });
      log('packaging', '\n📦 Packaging project...');

      // Derive project name from goal
      const projectName = goal
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 30) || 'project';

      const packageResult = await this.packager.package(sandbox, projectName, onEvent);
      const downloadUrl = `/api/agent/download/${taskId}`;

      // Mark as complete
      TaskStore.complete(taskId, downloadUrl, packageResult.zipPath, packageResult.fileCount);
      log('system', `\n✅ Project complete! ${packageResult.fileCount} files, ${(packageResult.sizeBytes / 1024).toFixed(1)}KB`);

      onEvent?.({
        type: 'done',
        content: JSON.stringify({
          status: 'complete',
          downloadUrl,
          fileCount: packageResult.fileCount,
        }),
        stage: 'complete',
      });

      return {
        success: true,
        taskId,
        fileCount: packageResult.fileCount,
        downloadUrl,
        zipPath: packageResult.zipPath,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Pipeline failed';
      TaskStore.fail(taskId, msg);
      log('error', `\n❌ Task failed: ${msg}`);

      // Still try to package partial output
      let zipPath: string | undefined;
      let fileCount = sandbox.listFiles().length;

      if (fileCount > 0) {
        try {
          const partial = await this.packager.package(sandbox, 'partial-output', onEvent);
          zipPath = partial.zipPath;
          fileCount = partial.fileCount;
          const downloadUrl = `/api/agent/download/${taskId}`;
          TaskStore.update(taskId, { downloadUrl, zipPath, fileCount });
        } catch {
          // Can't package partial output
        }
      }

      onEvent?.({
        type: 'error',
        content: JSON.stringify({ status: 'failed', error: msg }),
        stage: 'error',
      });

      return {
        success: false,
        taskId,
        fileCount,
        zipPath,
        error: msg,
        durationMs: Date.now() - startTime,
      };
    } finally {
      sandbox.cleanup();
    }
  }
}
