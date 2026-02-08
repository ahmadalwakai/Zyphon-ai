import path from 'path';
import fs from 'fs/promises';
import { 
  AgentPlanStep, 
  ToolResult, 
  ToolType, 
  StepStatus, 
  StepType,
  isLLMImageRefusal, 
  classifyIntent,
  PlanStep,
  ExecutionPlan,
  ExecutionContext,
  StepResult,
  DEFAULT_CONSTRAINTS,
} from '@zyphon/shared';
import { LLMTool } from '../tools/llm.js';
import { ImageTool } from '../tools/image.js';
import { TerminalTool } from '../tools/terminal.js';
import { BrowserTool } from '../tools/browser.js';
import { FSTool, FSInput } from '../tools/fs.js';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'executor-agent' });

interface LegacyExecutorContext {
  taskId: string;
  workspacePath: string;
  previousOutputs: Map<number, unknown>;
  taskGoal?: string;
}

interface LegacyStepExecutionResult {
  stepIndex: number;
  status: StepStatus;
  result: ToolResult;
}

export class ExecutorAgent {
  private llm: LLMTool;
  private image: ImageTool;
  private terminal: TerminalTool;
  private browser: BrowserTool;
  private fs: FSTool;

  constructor(
    llm?: LLMTool, 
    image?: ImageTool,
    terminal?: TerminalTool,
    browser?: BrowserTool,
    fsTool?: FSTool
  ) {
    this.llm = llm || new LLMTool();
    this.image = image || new ImageTool();
    this.terminal = terminal || new TerminalTool();
    this.browser = browser || new BrowserTool();
    this.fs = fsTool || new FSTool();
  }

  /**
   * Execute a single step from the new ExecutionPlan format.
   */
  async executePlanStep(
    step: PlanStep, 
    context: ExecutionContext
  ): Promise<StepResult> {
    const startTime = Date.now();
    logger.info({ 
      taskId: context.taskId, 
      stepId: step.id, 
      type: step.type,
      tool: step.tool 
    }, 'Executing plan step');

    // Check step budget
    if (context.stepCount >= context.constraints.maxSteps) {
      logger.warn({ taskId: context.taskId, stepId: step.id }, 'Step budget exhausted');
      return {
        stepId: step.id,
        status: 'FAILED',
        result: {
          success: false,
          output: null,
          error: 'STEP_BUDGET_EXHAUSTED: Maximum steps reached',
          duration: 0,
        },
        retryCount: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    // Check time budget
    const elapsedSeconds = (Date.now() - context.startTime) / 1000;
    if (elapsedSeconds >= context.constraints.maxSeconds) {
      logger.warn({ taskId: context.taskId, stepId: step.id }, 'Time budget exhausted');
      return {
        stepId: step.id,
        status: 'FAILED',
        result: {
          success: false,
          output: null,
          error: 'TIME_BUDGET_EXHAUSTED: Maximum time reached',
          duration: 0,
        },
        retryCount: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    context.stepCount++;

    try {
      // Enrich input with previous step outputs
      const enrichedInput = this.enrichStepInput(step.input, context);
      
      // Execute based on tool type
      const result = await this.runToolForStep(step, enrichedInput, context);

      // Handle retries on failure
      let retryCount = 0;
      let finalResult = result;
      
      if (!result.success && step.on_fail?.retry && step.on_fail.retry > 0) {
        retryCount = 1;
        logger.info({ stepId: step.id, retryCount }, 'Retrying failed step');
        finalResult = await this.runToolForStep(step, enrichedInput, context);
      }

      // Store output for dependent steps
      if (finalResult.success) {
        context.previousOutputs.set(step.id, finalResult.output);
      }

      // Save step log
      await this.saveStepLog(step, finalResult, context);

      const status: StepStatus = finalResult.success ? 'COMPLETED' : 'FAILED';
      const completedAt = new Date().toISOString();

      logger.info({ 
        taskId: context.taskId, 
        stepId: step.id, 
        status, 
        duration: finalResult.duration 
      }, 'Plan step completed');

      const stepResult: StepResult = {
        stepId: step.id,
        status,
        result: finalResult,
        retryCount,
        startedAt: new Date(startTime).toISOString(),
        completedAt,
      };

      context.stepResults.set(step.id, stepResult);
      return stepResult;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ taskId: context.taskId, stepId: step.id, error: message }, 'Step execution failed');

      const result: ToolResult = {
        success: false,
        output: null,
        error: message,
        duration: Date.now() - startTime,
      };

      return {
        stepId: step.id,
        status: 'FAILED',
        result,
        retryCount: 0,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Run the appropriate tool for a step.
   */
  private async runToolForStep(
    step: PlanStep, 
    input: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const { tool, type } = step;

    logger.debug({ stepId: step.id, tool, type, input }, 'Running tool');

    switch (tool) {
      case 'LLM':
        return this.runLLMTool(input);

      case 'IMAGE':
        return this.runImageTool(input, context);

      case 'TERMINAL':
        return this.runTerminalTool(input, context);

      case 'BROWSER':
        return this.runBrowserTool(input, context);

      case 'FS':
      case 'FILE':
        return this.runFSTool(input, context);

      case 'NONE':
        // VERIFY or PLAN steps that don't need external tools
        return this.runVerifyTool(input, context);

      default:
        return {
          success: false,
          output: null,
          error: `Unknown tool: ${tool}`,
          duration: 0,
        };
    }
  }

  /**
   * Run LLM tool for code generation or analysis.
   */
  private async runLLMTool(input: Record<string, unknown>): Promise<ToolResult> {
    const prompt = String(input['prompt'] || '');
    const systemPrompt = input['systemPrompt'] as string | undefined;

    return this.llm.generate({
      prompt,
      systemPrompt,
      temperature: 0.2,
    });
  }

  /**
   * Run IMAGE tool for image generation.
   */
  private async runImageTool(
    input: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const imagesDir = path.join(context.workspacePath, 'outputs', 'images');
    await fs.mkdir(imagesDir, { recursive: true });
    
    const outputPath = path.join(imagesDir, `image_${Date.now()}.png`);

    return this.image.generate({
      prompt: String(input['prompt'] || context.goal),
      outputPath,
      width: (input['width'] as number) || 1024,
      height: (input['height'] as number) || 1024,
    });
  }

  /**
   * Run TERMINAL tool for command execution.
   */
  private async runTerminalTool(
    input: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    // Check constraint
    if (!context.constraints.allowTerminal) {
      return {
        success: false,
        output: null,
        error: 'TERMINAL_NOT_ALLOWED: Terminal execution is disabled by constraints',
        duration: 0,
      };
    }

    return this.terminal.execute({
      command: String(input['command'] || ''),
      cwd: input['cwd'] as string | undefined,
      timeout: input['timeout'] as number | undefined,
      env: input['env'] as Record<string, string> | undefined,
    }, context.workspacePath);
  }

  /**
   * Run BROWSER tool for browser automation.
   */
  private async runBrowserTool(
    input: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    // Check constraint
    if (!context.constraints.allowBrowser) {
      return {
        success: false,
        output: null,
        error: 'BROWSER_NOT_ALLOWED: Browser automation is disabled by constraints',
        duration: 0,
      };
    }

    return this.browser.execute({
      url: input['url'] as string | undefined,
      action: (input['action'] as 'goto' | 'click' | 'type' | 'screenshot' | 'waitForNetworkIdle' | 'waitForSelector') || 'goto',
      selector: input['selector'] as string | undefined,
      text: input['text'] as string | undefined,
      timeout: input['timeout'] as number | undefined,
      screenshotName: input['screenshotName'] as string | undefined,
    }, context.workspacePath);
  }

  /**
   * Run FS tool for file operations.
   */
  private async runFSTool(
    input: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const fsInput: FSInput = {
      operation: (input['operation'] as FSInput['operation']) || 'write',
      path: String(input['path'] || ''),
      content: input['content'] as string | undefined,
      patchFind: input['patchFind'] as string | undefined,
      patchReplace: input['patchReplace'] as string | undefined,
    };

    return this.fs.execute(fsInput, context.workspacePath);
  }

  /**
   * Run verification for VERIFY steps.
   */
  private async runVerifyTool(
    input: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const expectedOutputs = input['expectedOutputs'] as string[] | undefined;
    const checkArtifacts = input['checkArtifacts'] as boolean;
    const missingArtifacts: string[] = [];

    if (checkArtifacts && expectedOutputs) {
      // Check for expected artifacts
      for (const expectedOutput of expectedOutputs) {
        const exists = await this.checkArtifactExists(expectedOutput, context.workspacePath);
        if (!exists) {
          missingArtifacts.push(expectedOutput);
        }
      }
    }

    const success = missingArtifacts.length === 0;
    
    return {
      success,
      output: {
        verified: success,
        missingArtifacts,
        expectedOutputs,
      },
      error: success ? undefined : `Missing artifacts: ${missingArtifacts.join(', ')}`,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Check if an artifact type exists in the workspace.
   */
  private async checkArtifactExists(artifactType: string, workspacePath: string): Promise<boolean> {
    try {
      switch (artifactType) {
        case 'image': {
          const imagesDir = path.join(workspacePath, 'outputs', 'images');
          const files = await fs.readdir(imagesDir).catch(() => []);
          return files.some(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));
        }
        case 'code':
        case 'files': {
          const outputsDir = path.join(workspacePath, 'outputs');
          const files = await fs.readdir(outputsDir).catch(() => []);
          return files.some(f => /\.(ts|tsx|js|jsx|html|css)$/i.test(f));
        }
        case 'browser_check': {
          const browserDir = path.join(workspacePath, 'outputs', 'browser');
          const files = await fs.readdir(browserDir).catch(() => []);
          return files.some(f => f.endsWith('.png'));
        }
        case 'terminal': {
          const logsDir = path.join(workspacePath, 'logs', 'terminal');
          const files = await fs.readdir(logsDir).catch(() => []);
          return files.length > 0;
        }
        default:
          return true; // Unknown types pass by default
      }
    } catch {
      return false;
    }
  }

  /**
   * Enrich step input with previous outputs.
   */
  private enrichStepInput(
    input: Record<string, unknown>,
    context: ExecutionContext
  ): Record<string, unknown> {
    const enriched = { ...input };

    for (const [key, value] of Object.entries(enriched)) {
      if (typeof value === 'string') {
        // Replace $step[stepId].field references
        const stepRefPattern = /\$step\[([^\]]+)\]\.?(\w*)/g;
        enriched[key] = value.replace(stepRefPattern, (match, stepId, field) => {
          const previousOutput = context.previousOutputs.get(stepId);
          if (previousOutput === undefined) return match;
          
          if (field && typeof previousOutput === 'object' && previousOutput !== null) {
            return String((previousOutput as Record<string, unknown>)[field] || match);
          }
          return String(previousOutput);
        });
      }
    }

    return enriched;
  }

  /**
   * Save step execution log.
   */
  private async saveStepLog(
    step: PlanStep,
    result: ToolResult,
    context: ExecutionContext
  ): Promise<void> {
    const logsDir = path.join(context.workspacePath, 'logs');
    await fs.mkdir(logsDir, { recursive: true });

    const logEntry = {
      step: {
        id: step.id,
        type: step.type,
        tool: step.tool,
        input: step.input,
      },
      result: {
        success: result.success,
        duration: result.duration,
        error: result.error,
        outputPreview: typeof result.output === 'string'
          ? result.output.substring(0, 500)
          : JSON.stringify(result.output)?.substring(0, 500),
        artifacts: result.artifacts,
      },
      timestamp: new Date().toISOString(),
    };

    const logPath = path.join(logsDir, `step_${step.id}_${Date.now()}.json`);
    await fs.writeFile(logPath, JSON.stringify(logEntry, null, 2));
  }

  // ====================================================================
  // LEGACY SUPPORT: Keep existing executeStep method for backwards compat
  // ====================================================================

  async executeStep(step: AgentPlanStep, context: LegacyExecutorContext): Promise<LegacyStepExecutionResult> {
    logger.info({ taskId: context.taskId, stepIndex: step.index, tool: step.tool }, 'Executing legacy step');

    try {
      // Validate tool for task
      const validatedTool = this.validateToolForLegacyTask(step, context);
      if (validatedTool !== step.tool) {
        logger.warn({ 
          taskId: context.taskId, 
          originalTool: step.tool, 
          correctedTool: validatedTool 
        }, 'Tool corrected by executor guardrail');
      }

      const enrichedInput = this.enrichLegacyInput(step.input, context);
      const result = await this.runLegacyTool(validatedTool, enrichedInput, context);

      // GUARDRAIL: Check for LLM image refusal
      if (this.isLegacyImageIntendedTask(step, context) && result.success && typeof result.output === 'string') {
        if (isLLMImageRefusal(result.output)) {
          logger.error({ taskId: context.taskId, stepIndex: step.index }, 'LLM returned image refusal');
          
          const imageResult = await this.runImageTool(
            { prompt: this.extractPromptFromInput(step.input), width: 1024, height: 1024 },
            {
              taskId: context.taskId,
              workspacePath: context.workspacePath,
              goal: context.taskGoal || '',
              constraints: DEFAULT_CONSTRAINTS,
              previousOutputs: new Map(),
              stepResults: new Map(),
              startTime: Date.now(),
              stepCount: 0,
            }
          );
          
          const status: StepStatus = imageResult.success ? 'COMPLETED' : 'FAILED';
          if (imageResult.success) {
            context.previousOutputs.set(step.index, imageResult.output);
          }
          await this.saveLegacyStepLog(step, imageResult, context);
          
          return { stepIndex: step.index, status, result: imageResult };
        }
      }

      // Validation for IMAGE tool
      if (validatedTool === 'IMAGE' && result.success) {
        if (!result.artifacts || result.artifacts.length === 0 || 
            !result.artifacts.some(a => a.type.startsWith('image/'))) {
          logger.error({ taskId: context.taskId, stepIndex: step.index }, 'IMAGE tool did not produce artifact');
          return {
            stepIndex: step.index,
            status: 'FAILED',
            result: {
              success: false,
              output: null,
              error: 'IMAGE_GENERATION_FAILED: No image artifact produced',
              duration: result.duration,
            },
          };
        }
      }

      const status: StepStatus = result.success ? 'COMPLETED' : 'FAILED';

      if (result.success) {
        context.previousOutputs.set(step.index, result.output);
      }

      await this.saveLegacyStepLog(step, result, context);

      logger.info({ taskId: context.taskId, stepIndex: step.index, status, duration: result.duration }, 'Legacy step completed');

      return { stepIndex: step.index, status, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ taskId: context.taskId, stepIndex: step.index, error: message }, 'Legacy step failed');

      const result: ToolResult = {
        success: false,
        output: null,
        error: message,
        duration: 0,
      };

      return { stepIndex: step.index, status: 'FAILED', result };
    }
  }

  private validateToolForLegacyTask(step: AgentPlanStep, context: LegacyExecutorContext): ToolType {
    if (context.taskGoal) {
      const intent = classifyIntent(context.taskGoal);
      if (intent.expectedOutput === 'IMAGE' && step.tool === 'LLM') {
        logger.warn({ taskId: context.taskId, stepIndex: step.index }, 'Forcing IMAGE tool');
        return 'IMAGE';
      }
    }
    
    const stepDescription = step.description?.toLowerCase() || '';
    const stepName = step.name?.toLowerCase() || '';
    const promptInput = this.extractPromptFromInput(step.input)?.toLowerCase() || '';
    
    const imageSignals = ['image', 'generate', 'render', 'photo', 'cinematic', 'visual'];
    const hasImageSignal = imageSignals.some(signal => 
      stepDescription.includes(signal) || stepName.includes(signal) || promptInput.includes(signal)
    );
    
    if (hasImageSignal && step.tool === 'LLM') {
      logger.warn({ taskId: context.taskId, stepIndex: step.index }, 'Forcing IMAGE tool based on step content');
      return 'IMAGE';
    }
    
    return step.tool;
  }

  private isLegacyImageIntendedTask(step: AgentPlanStep, context: LegacyExecutorContext): boolean {
    if (step.tool === 'IMAGE') return true;
    
    if (context.taskGoal) {
      const intent = classifyIntent(context.taskGoal);
      return intent.expectedOutput === 'IMAGE';
    }
    
    return false;
  }

  private extractPromptFromInput(input: unknown): string {
    if (!input || typeof input !== 'object') return '';
    const inputObj = input as Record<string, unknown>;
    return String(inputObj['prompt'] || inputObj['goal'] || '');
  }

  private async runLegacyTool(tool: ToolType, input: unknown, context: LegacyExecutorContext): Promise<ToolResult> {
    const execContext: ExecutionContext = {
      taskId: context.taskId,
      workspacePath: context.workspacePath,
      goal: context.taskGoal || '',
      constraints: DEFAULT_CONSTRAINTS,
      previousOutputs: new Map(),
      stepResults: new Map(),
      startTime: Date.now(),
      stepCount: 0,
    };

    switch (tool) {
      case 'LLM':
        return this.runLLMTool(input as Record<string, unknown>);

      case 'IMAGE':
        return this.runImageTool(input as Record<string, unknown>, execContext);

      case 'FILE':
      case 'FS':
        return this.runFSTool(input as Record<string, unknown>, execContext);

      case 'SHELL':
      case 'TERMINAL':
        return this.runTerminalTool(input as Record<string, unknown>, execContext);

      case 'BROWSER':
        return this.runBrowserTool(input as Record<string, unknown>, execContext);

      default:
        return {
          success: false,
          output: null,
          error: `Unknown tool: ${tool}`,
          duration: 0,
        };
    }
  }

  private enrichLegacyInput(input: unknown, context: LegacyExecutorContext): unknown {
    if (typeof input !== 'object' || input === null) {
      return input;
    }

    const enriched = { ...input } as Record<string, unknown>;

    for (const [key, value] of Object.entries(enriched)) {
      if (typeof value === 'string' && value.startsWith('$step[')) {
        const match = value.match(/\$step\[(\d+)\]\.?(.*)$/);
        if (match) {
          const stepIndex = parseInt(match[1]!, 10);
          const path = match[2];
          const previousOutput = context.previousOutputs.get(stepIndex);

          if (previousOutput !== undefined) {
            enriched[key] = path ? this.getNestedValue(previousOutput, path) : previousOutput;
          }
        }
      }
    }

    return enriched;
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private async saveLegacyStepLog(step: AgentPlanStep, result: ToolResult, context: LegacyExecutorContext): Promise<void> {
    const logsDir = path.join(context.workspacePath, 'logs');
    await fs.mkdir(logsDir, { recursive: true });

    const logEntry = {
      step,
      result: {
        success: result.success,
        duration: result.duration,
        error: result.error,
        outputPreview: typeof result.output === 'string'
          ? result.output.substring(0, 500)
          : JSON.stringify(result.output)?.substring(0, 500),
        artifacts: result.artifacts,
      },
      timestamp: new Date().toISOString(),
    };

    const logPath = path.join(logsDir, `step_${step.index}.json`);
    await fs.writeFile(logPath, JSON.stringify(logEntry, null, 2));
  }
}

export const executorAgent = new ExecutorAgent();
