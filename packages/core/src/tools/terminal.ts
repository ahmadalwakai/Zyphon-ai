import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import {
  ToolResult,
  TerminalInput,
  TerminalOutput,
  TERMINAL_TIMEOUT_MS,
  TERMINAL_ALLOWLIST,
  TERMINAL_BLOCKLIST,
} from '@zyphon/shared';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'terminal-tool' });

/**
 * TerminalTool - Sandboxed terminal command runner
 * 
 * Features:
 * - Allowlist-based command validation
 * - Blocklist for dangerous commands
 * - Working directory constraints
 * - Stdout/stderr capture
 * - Timeout support
 */
export class TerminalTool {
  private workspaceRoot: string;
  private timeout: number;

  constructor(
    workspaceRoot: string = process.env['WORKSPACE_ROOT'] || (process.env['VERCEL'] ? '/tmp/workspaces' : './workspaces'),
    timeout: number = TERMINAL_TIMEOUT_MS
  ) {
    this.workspaceRoot = workspaceRoot;
    this.timeout = timeout;
  }

  /**
   * Validate command against allowlist and blocklist
   */
  private validateCommand(command: string): { valid: boolean; error?: string } {
    const normalizedCmd = command.toLowerCase().trim();

    // Check blocklist first (security critical)
    for (const blocked of TERMINAL_BLOCKLIST) {
      if (normalizedCmd.includes(blocked.toLowerCase())) {
        return {
          valid: false,
          error: `BLOCKED_COMMAND: Command contains blocked pattern "${blocked}"`,
        };
      }
    }

    // Check if command starts with any allowlisted pattern
    const isAllowed = TERMINAL_ALLOWLIST.some(allowed => {
      const normalizedAllowed = allowed.toLowerCase();
      return normalizedCmd.startsWith(normalizedAllowed) ||
             normalizedCmd.includes(normalizedAllowed);
    });

    if (!isAllowed) {
      // Allow simple path operations and echo for debugging
      const basicAllowed = [
        /^echo\s/i,
        /^pwd$/i,
        /^cd\s/i,
        /^ls(\s|$)/i,
        /^dir(\s|$)/i,
        /^cat\s/i,
        /^type\s/i,
        /^mkdir\s/i,
      ];

      const isBasicAllowed = basicAllowed.some(pattern => pattern.test(command));
      if (!isBasicAllowed) {
        return {
          valid: false,
          error: `COMMAND_NOT_ALLOWED: Command "${command.substring(0, 50)}..." is not in the allowlist`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Ensure working directory is within workspace bounds
   */
  private resolveWorkingDir(cwd: string | undefined, workspacePath: string): string {
    if (!cwd) {
      return workspacePath;
    }

    const resolvedPath = path.isAbsolute(cwd)
      ? cwd
      : path.join(workspacePath, cwd);

    // Security: Ensure we're still within workspace
    const normalizedResolved = path.normalize(resolvedPath);
    const normalizedWorkspace = path.normalize(workspacePath);

    if (!normalizedResolved.startsWith(normalizedWorkspace)) {
      logger.warn({ cwd, workspacePath }, 'Attempted directory escape, using workspace root');
      return workspacePath;
    }

    return resolvedPath;
  }

  /**
   * Execute a terminal command
   */
  async execute(input: TerminalInput, workspacePath: string): Promise<ToolResult> {
    const startTime = Date.now();

    // Validate command
    const validation = this.validateCommand(input.command);
    if (!validation.valid) {
      logger.warn({ command: input.command, error: validation.error }, 'Command validation failed');
      return {
        success: false,
        output: null,
        error: validation.error,
        duration: Date.now() - startTime,
      };
    }

    const cwd = this.resolveWorkingDir(input.cwd, workspacePath);

    // Ensure cwd exists
    try {
      await fs.access(cwd);
    } catch {
      await fs.mkdir(cwd, { recursive: true });
    }

    const timeout = input.timeout ?? this.timeout;

    logger.info({ command: input.command, cwd, timeout }, 'Executing terminal command');

    try {
      const result = await this.runCommand(input.command, cwd, timeout, input.env);
      const duration = Date.now() - startTime;

      const output: TerminalOutput = {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration,
        command: input.command,
        cwd,
      };

      // Save execution log
      await this.saveExecutionLog(workspacePath, output);

      const success = result.exitCode === 0;

      logger.info({
        command: input.command,
        exitCode: result.exitCode,
        duration,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length,
      }, `Command ${success ? 'succeeded' : 'failed'}`);

      return {
        success,
        output,
        error: success ? undefined : `Exit code: ${result.exitCode}\n${result.stderr}`,
        duration,
        artifacts: this.detectArtifacts(result.stdout, cwd),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ command: input.command, error: message }, 'Terminal command failed');

      return {
        success: false,
        output: null,
        error: `TERMINAL_ERROR: ${message}`,
        duration,
      };
    }
  }

  /**
   * Run command with timeout
   */
  private runCommand(
    command: string,
    cwd: string,
    timeout: number,
    env?: Record<string, string>
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      // Use shell: true which automatically handles platform differences
      // This avoids issues with cmd.exe not being in PATH on some Windows configs
      const childProcess = spawn(command, [], {
        cwd,
        env: { ...process.env, ...env },
        timeout,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true, // Cross-platform shell execution
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        // Limit output size
        if (stdout.length > 100000) {
          stdout = stdout.substring(0, 100000) + '\n... [truncated]';
          childProcess.kill();
        }
      });

      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        // Limit output size
        if (stderr.length > 100000) {
          stderr = stderr.substring(0, 100000) + '\n... [truncated]';
        }
      });

      childProcess.on('error', (error) => {
        reject(error);
      });

      childProcess.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });

      // Timeout handling
      setTimeout(() => {
        if (!childProcess.killed) {
          childProcess.kill('SIGTERM');
          reject(new Error(`Command timed out after ${timeout}ms`));
        }
      }, timeout);
    });
  }

  /**
   * Save execution log to workspace
   */
  private async saveExecutionLog(workspacePath: string, output: TerminalOutput): Promise<void> {
    try {
      const logsDir = path.join(workspacePath, 'logs', 'terminal');
      await fs.mkdir(logsDir, { recursive: true });

      const logFile = path.join(logsDir, `cmd_${Date.now()}.json`);
      await fs.writeFile(logFile, JSON.stringify({
        ...output,
        timestamp: new Date().toISOString(),
      }, null, 2));
    } catch (error) {
      logger.warn({ error }, 'Failed to save terminal execution log');
    }
  }

  /**
   * Detect any artifacts mentioned in stdout
   */
  private detectArtifacts(stdout: string, cwd: string): ToolResult['artifacts'] {
    const artifacts: ToolResult['artifacts'] = [];

    // Pattern to detect file paths in output
    const filePatterns = [
      /output(?:\.|\:|\s)+([\w\-\.\/\\]+\.(js|ts|json|html|css|png|jpg|jpeg|svg))/gi,
      /created?\s+([\w\-\.\/\\]+\.(js|ts|json|html|css|png|jpg|jpeg|svg))/gi,
      /wrote\s+([\w\-\.\/\\]+)/gi,
    ];

    for (const pattern of filePatterns) {
      const matches = stdout.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          const filePath = path.join(cwd, match[1]);
          const ext = path.extname(match[1]);
          artifacts.push({
            name: path.basename(match[1]),
            path: filePath,
            type: this.getMimeType(ext),
            size: 0, // Would need to stat file to get actual size
          });
        }
      }
    }

    return artifacts.length > 0 ? artifacts : undefined;
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.js': 'application/javascript',
      '.ts': 'application/typescript',
      '.json': 'application/json',
      '.html': 'text/html',
      '.css': 'text/css',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

export const terminalTool = new TerminalTool();
