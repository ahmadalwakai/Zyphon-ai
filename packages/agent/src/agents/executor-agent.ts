/**
 * Executor Agent — Runs commands in the sandbox and captures output.
 * Handles dependency installation, builds, and test execution.
 */

import type { Sandbox } from '@zyphon/executor';
import type { CommandResult } from '@zyphon/executor';
import type { GroqStreamCallback } from '../llm/groq-client.js';
import type { PlanStep } from './planner.js';

export interface ExecutionResult {
  step: PlanStep;
  success: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class ExecutorAgent {
  /**
   * Execute a command step in the sandbox.
   */
  async execute(
    step: PlanStep,
    sandbox: Sandbox,
    onLog?: GroqStreamCallback
  ): Promise<ExecutionResult> {
    if (!step.command) {
      throw new Error(`Step ${step.step} has no command to execute`);
    }

    onLog?.({
      type: 'token',
      content: `\n⚡ Executing: ${step.command}\n`,
      stage: 'executing',
    });

    let result: CommandResult;

    try {
      result = await sandbox.exec(step.command);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown execution error';
      return {
        step,
        success: false,
        stdout: '',
        stderr: message,
        durationMs: 0,
      };
    }

    // Log output
    if (result.stdout) {
      onLog?.({
        type: 'token',
        content: `stdout: ${result.stdout.substring(0, 1000)}\n`,
        stage: 'executing',
      });
    }

    if (result.stderr) {
      onLog?.({
        type: 'token',
        content: `stderr: ${result.stderr.substring(0, 1000)}\n`,
        stage: 'executing',
      });
    }

    onLog?.({
      type: result.success ? 'done' : 'error',
      content: result.success
        ? `✓ Command succeeded (${result.durationMs}ms)\n`
        : `✗ Command failed (exit code ${result.exitCode})\n`,
      stage: 'executing',
    });

    return {
      step,
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
    };
  }

  /**
   * Execute multiple commands sequentially.
   */
  async executeAll(
    steps: PlanStep[],
    sandbox: Sandbox,
    onLog?: GroqStreamCallback
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    for (const step of steps) {
      if (step.command) {
        const result = await this.execute(step, sandbox, onLog);
        results.push(result);
      }
    }

    return results;
  }
}
