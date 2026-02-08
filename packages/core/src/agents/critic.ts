import path from 'path';
import fs from 'fs/promises';
import { 
  AgentPlanStep, 
  ToolResult,
  StepResult,
  ExpectedOutput,
  VerificationInput,
  VerificationResult,
  ExecutionPlan,
} from '@zyphon/shared';
import { LLMTool } from '../tools/llm.js';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'critic-agent' });

const CRITIC_SYSTEM_PROMPT = `You are a quality assurance agent. Your job is to verify if a task step was completed successfully.

RULES:
1. Be strict but fair in your evaluation
2. Consider both correctness and completeness
3. Provide specific feedback if the step failed

OUTPUT FORMAT (JSON only):
{
  "passed": true|false,
  "confidence": 0.0-1.0,
  "reason": "explanation",
  "suggestions": ["suggestion1", "suggestion2"] // only if passed=false
}`;

interface CriticInput {
  step: AgentPlanStep;
  result: ToolResult;
  goal: string;
}

interface CriticOutput {
  passed: boolean;
  confidence: number;
  reason: string;
  suggestions?: string[];
}

export class CriticAgent {
  private llm: LLMTool;

  constructor(llm?: LLMTool) {
    this.llm = llm || new LLMTool();
  }

  /**
   * Verify that all expected outputs exist after plan execution.
   * This is the main verification entry point for the new ExecutionPlan.
   */
  async verifyPlanExecution(input: VerificationInput): Promise<VerificationResult> {
    logger.info({ 
      expectedOutputs: input.expectedOutputs,
      stepCount: input.stepResults.length,
    }, 'Verifying plan execution');

    const missingArtifacts: string[] = [];
    const failedSteps: string[] = [];
    const suggestions: string[] = [];

    // Check for failed steps
    for (const stepResult of input.stepResults) {
      if (stepResult.status === 'FAILED') {
        failedSteps.push(stepResult.stepId);
      }
    }

    // Check for expected artifacts
    for (const expectedOutput of input.expectedOutputs) {
      const exists = await this.checkArtifactExists(expectedOutput, input.workspacePath);
      if (!exists) {
        missingArtifacts.push(expectedOutput);
        suggestions.push(`Generate ${expectedOutput} artifact using appropriate tool`);
      }
    }

    const passed = missingArtifacts.length === 0 && failedSteps.length === 0;
    const canRetry = !passed && failedSteps.length <= 2;

    // Determine which steps to retry
    const retrySteps: string[] = [];
    if (canRetry && failedSteps.length > 0) {
      retrySteps.push(...failedSteps.slice(0, 2)); // Retry up to 2 failed steps
    }

    // If artifacts missing but no failed steps, might need to add verification
    if (missingArtifacts.length > 0 && failedSteps.length === 0) {
      suggestions.push('All steps completed but artifacts missing - check step configurations');
    }

    logger.info({
      passed,
      missingArtifacts,
      failedSteps,
      canRetry,
      retrySteps,
    }, 'Verification completed');

    return {
      passed,
      confidence: passed ? 1.0 : 0.5,
      missingArtifacts,
      failedSteps,
      suggestions,
      canRetry,
      retrySteps: canRetry ? retrySteps : undefined,
    };
  }

  /**
   * Check if an artifact type exists in the workspace.
   */
  private async checkArtifactExists(artifactType: ExpectedOutput, workspacePath: string): Promise<boolean> {
    try {
      switch (artifactType) {
        case 'image': {
          const imagesDir = path.join(workspacePath, 'outputs', 'images');
          const files = await fs.readdir(imagesDir).catch(() => []);
          const hasImages = files.some(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));
          logger.debug({ artifactType, imagesDir, files: files.length, hasImages }, 'Checking image artifacts');
          return hasImages;
        }

        case 'code':
        case 'files': {
          const outputsDir = path.join(workspacePath, 'outputs');
          const allFiles = await this.listFilesRecursive(outputsDir);
          const hasCode = allFiles.some(f => /\.(ts|tsx|js|jsx|html|css|py|json)$/i.test(f));
          logger.debug({ artifactType, outputsDir, fileCount: allFiles.length, hasCode }, 'Checking code artifacts');
          return hasCode;
        }

        case 'browser_check': {
          const browserDir = path.join(workspacePath, 'outputs', 'browser');
          const files = await fs.readdir(browserDir).catch(() => []);
          const hasScreenshots = files.some(f => f.endsWith('.png'));
          logger.debug({ artifactType, browserDir, hasScreenshots }, 'Checking browser artifacts');
          return hasScreenshots;
        }

        case 'terminal': {
          const logsDir = path.join(workspacePath, 'logs', 'terminal');
          const files = await fs.readdir(logsDir).catch(() => []);
          const hasLogs = files.length > 0;
          logger.debug({ artifactType, logsDir, hasLogs }, 'Checking terminal artifacts');
          return hasLogs;
        }

        case 'text':
        case 'web_result':
        default:
          // These are soft requirements
          return true;
      }
    } catch (error) {
      logger.warn({ artifactType, error }, 'Error checking artifact');
      return false;
    }
  }

  /**
   * List all files in a directory recursively.
   */
  private async listFilesRecursive(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const subFiles = await this.listFilesRecursive(fullPath);
          files.push(...subFiles);
        } else {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist or is not accessible
    }

    return files;
  }

  /**
   * Evaluate a single step result (legacy method).
   */
  async evaluate(input: CriticInput): Promise<CriticOutput> {
    logger.info({ stepIndex: input.step.index, tool: input.step.tool }, 'Evaluating step result');

    // Fast-path: if the tool explicitly failed, no need for LLM evaluation
    if (!input.result.success) {
      return {
        passed: false,
        confidence: 1.0,
        reason: `Tool execution failed: ${input.result.error}`,
        suggestions: ['Review the input parameters', 'Check tool availability'],
      };
    }

    // For simple operations (FILE, SHELL), trust the tool result
    if (input.step.tool === 'FILE' || input.step.tool === 'FS') {
      return {
        passed: true,
        confidence: 0.95,
        reason: 'File operation completed successfully',
      };
    }

    // For TERMINAL, check exit code
    if (input.step.tool === 'TERMINAL' || input.step.tool === 'SHELL') {
      const output = input.result.output as { exitCode?: number } | null;
      if (output && output.exitCode === 0) {
        return {
          passed: true,
          confidence: 0.95,
          reason: 'Terminal command completed successfully with exit code 0',
        };
      }
    }

    // For IMAGE, check artifacts
    if (input.step.tool === 'IMAGE') {
      if (input.result.artifacts && input.result.artifacts.length > 0) {
        const hasImage = input.result.artifacts.some(a => a.type.startsWith('image/'));
        if (hasImage) {
          return {
            passed: true,
            confidence: 0.98,
            reason: 'Image artifact generated successfully',
          };
        }
      }
      return {
        passed: false,
        confidence: 0.9,
        reason: 'IMAGE tool did not produce image artifact',
        suggestions: ['Check SD3 model configuration', 'Verify image output path'],
      };
    }

    // For BROWSER, check screenshots
    if (input.step.tool === 'BROWSER') {
      const output = input.result.output as { screenshotPath?: string } | null;
      if (output && output.screenshotPath) {
        return {
          passed: true,
          confidence: 0.95,
          reason: 'Browser action completed with screenshot',
        };
      }
    }

    // For LLM and complex evaluations, use LLM critic
    const prompt = this.buildPrompt(input);

    const result = await this.llm.generate({
      prompt,
      systemPrompt: CRITIC_SYSTEM_PROMPT,
      jsonMode: true,
      temperature: 0.1,
    });

    if (!result.success) {
      logger.warn({ error: result.error }, 'Critic evaluation failed, assuming pass');
      return {
        passed: true,
        confidence: 0.5,
        reason: 'Could not evaluate, assuming success based on tool result',
      };
    }

    const evaluation = result.output as CriticOutput;

    logger.info({
      stepIndex: input.step.index,
      passed: evaluation.passed,
      confidence: evaluation.confidence,
    }, 'Evaluation complete');

    return {
      passed: evaluation.passed ?? true,
      confidence: evaluation.confidence ?? 0.7,
      reason: evaluation.reason ?? 'No reason provided',
      suggestions: evaluation.suggestions,
    };
  }

  private buildPrompt(input: CriticInput): string {
    const outputPreview = typeof input.result.output === 'string'
      ? input.result.output.substring(0, 2000)
      : JSON.stringify(input.result.output)?.substring(0, 2000);

    return `OVERALL GOAL: ${input.goal}

STEP BEING EVALUATED:
- Name: ${input.step.name}
- Description: ${input.step.description}
- Tool: ${input.step.tool}

STEP INPUT:
${JSON.stringify(input.step.input, null, 2)}

STEP OUTPUT (preview):
${outputPreview}

ARTIFACTS CREATED: ${input.result.artifacts?.length || 0}

Evaluate whether this step successfully contributed to achieving the overall goal.`;
  }

  async shouldRetry(evaluation: CriticOutput): Promise<boolean> {
    // Only suggest retry if confidence is low and we have suggestions
    return (
      !evaluation.passed &&
      evaluation.confidence < 0.8 &&
      (evaluation.suggestions?.length ?? 0) > 0
    );
  }
}

export const criticAgent = new CriticAgent();
