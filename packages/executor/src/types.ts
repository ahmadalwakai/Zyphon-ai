/**
 * Types for the executor sandbox.
 */

export interface SandboxOptions {
  /** Unique task identifier */
  taskId: string;
  /** Maximum execution time in ms (default: 55_000 for Vercel safety) */
  timeoutMs?: number;
  /** Base directory for real FS operations (default: /tmp/zyphon) */
  basePath?: string;
}

export interface SandboxState {
  taskId: string;
  files: Map<string, string>;
  logs: LogEntry[];
  status: 'idle' | 'running' | 'completed' | 'failed';
  error?: string;
  createdAt: number;
}

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  stage: string;
  message: string;
  data?: unknown;
}

export interface FileEntry {
  path: string;
  content: string;
}
