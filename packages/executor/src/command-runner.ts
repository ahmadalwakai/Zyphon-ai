/**
 * Command Runner — executes shell commands in a temporary directory.
 * Captures stdout/stderr with timeout support.
 * Works on both Vercel (serverless) and local development.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export class CommandRunner {
  private workDir: string;
  private timeoutMs: number;

  constructor(workDir?: string, timeoutMs: number = 30_000) {
    this.workDir = workDir ?? path.join(os.tmpdir(), `zyphon-exec-${Date.now()}`);
    this.timeoutMs = timeoutMs;

    // Ensure the work directory exists
    if (!fs.existsSync(this.workDir)) {
      fs.mkdirSync(this.workDir, { recursive: true });
    }
  }

  /**
   * Execute a shell command and capture output.
   */
  run(command: string): CommandResult {
    const start = Date.now();

    try {
      const stdout = execSync(command, {
        cwd: this.workDir,
        timeout: this.timeoutMs,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024 * 5, // 5MB
        env: {
          ...process.env,
          NODE_ENV: 'production',
          // Prevent interactive prompts
          CI: 'true',
        },
      });

      return {
        success: true,
        stdout: stdout.substring(0, 50_000), // Limit output size
        stderr: '',
        exitCode: 0,
        durationMs: Date.now() - start,
      };
    } catch (error: unknown) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        status?: number;
        message?: string;
      };

      return {
        success: false,
        stdout: (err.stdout ?? '').substring(0, 50_000),
        stderr: (err.stderr ?? err.message ?? 'Unknown error').substring(0, 50_000),
        exitCode: err.status ?? 1,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Run multiple commands sequentially. Stops on first failure unless continueOnError is true.
   */
  runAll(commands: string[], continueOnError: boolean = false): CommandResult[] {
    const results: CommandResult[] = [];

    for (const cmd of commands) {
      const result = this.run(cmd);
      results.push(result);

      if (!result.success && !continueOnError) {
        break;
      }
    }

    return results;
  }

  /**
   * Get the working directory path.
   */
  getWorkDir(): string {
    return this.workDir;
  }

  /**
   * Clean up the working directory.
   */
  cleanup(): void {
    try {
      fs.rmSync(this.workDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures
    }
  }
}
