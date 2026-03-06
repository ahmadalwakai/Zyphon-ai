/**
 * Sandbox — High-level API combining VirtualFS + CommandRunner.
 * Each task gets its own sandbox with isolated file system and execution.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import { VirtualFS } from './virtual-fs.js';
import { CommandRunner, type CommandResult } from './command-runner.js';
import { Packager, type PackageResult } from './packager.js';
import type { SandboxOptions, SandboxState, LogEntry } from './types.js';

export class Sandbox {
  readonly taskId: string;
  readonly vfs: VirtualFS;
  readonly runner: CommandRunner;
  private logs: LogEntry[] = [];
  private status: SandboxState['status'] = 'idle';
  private error?: string;
  private readonly createdAt: number;
  private readonly timeoutMs: number;

  constructor(options: SandboxOptions) {
    this.taskId = options.taskId;
    this.timeoutMs = options.timeoutMs ?? 55_000;
    this.createdAt = Date.now();

    const basePath = options.basePath ?? path.join(os.tmpdir(), 'zyphon');
    const workDir = path.join(basePath, this.taskId);

    this.vfs = new VirtualFS();
    this.runner = new CommandRunner(workDir, this.timeoutMs);
  }

  /**
   * Write a file to the sandbox virtual file system.
   */
  writeFile(filePath: string, content: string): void {
    this.vfs.writeFile(filePath, content);
    this.log('info', 'fs', `Wrote file: ${filePath} (${content.length} bytes)`);
  }

  /**
   * Read a file from the sandbox.
   */
  readFile(filePath: string): string {
    return this.vfs.readFile(filePath);
  }

  /**
   * Execute a shell command in the sandbox.
   * Materializes virtual FS to real FS first.
   */
  async exec(command: string): Promise<CommandResult> {
    this.log('info', 'exec', `Running: ${command}`);

    // Materialize VFS to the runner's working directory
    await this.vfs.materialize(this.runner.getWorkDir());

    const result = this.runner.run(command);

    if (result.success) {
      this.log('info', 'exec', `Command succeeded (${result.durationMs}ms)`);
    } else {
      this.log('error', 'exec', `Command failed: ${result.stderr.substring(0, 500)}`);
    }

    return result;
  }

  /**
   * Package the sandbox into a downloadable zip.
   */
  async package(projectName?: string): Promise<PackageResult> {
    this.log('info', 'package', 'Packaging project...');
    const result = await Packager.package(this.vfs, this.taskId, projectName);
    this.log('info', 'package', `Packaged ${result.fileCount} files (${result.sizeBytes} bytes)`);
    return result;
  }

  /**
   * Add a log entry.
   */
  log(level: LogEntry['level'], stage: string, message: string, data?: unknown): void {
    this.logs.push({
      timestamp: Date.now(),
      level,
      stage,
      message,
      data,
    });
  }

  /**
   * Get all logs.
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get sandbox state.
   */
  getState(): SandboxState {
    return {
      taskId: this.taskId,
      files: new Map(this.vfs.getAllFiles().map(f => [f.path, f.content])),
      logs: this.getLogs(),
      status: this.status,
      error: this.error,
      createdAt: this.createdAt,
    };
  }

  /**
   * Set sandbox status.
   */
  setStatus(status: SandboxState['status'], error?: string): void {
    this.status = status;
    if (error) {
      this.error = error;
    }
  }

  /**
   * List all files in the sandbox.
   */
  listFiles(): string[] {
    return this.vfs.listFiles();
  }

  /**
   * Clean up sandbox resources.
   */
  cleanup(): void {
    this.runner.cleanup();
  }

  /**
   * Check if sandbox has timed out.
   */
  isTimedOut(): boolean {
    return Date.now() - this.createdAt > this.timeoutMs;
  }
}
