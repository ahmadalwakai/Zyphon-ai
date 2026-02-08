import path from 'path';
import fs from 'fs/promises';
import { ToolResult } from '@zyphon/shared';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'fs-tool' });

export type FSOperation = 'read' | 'write' | 'patch' | 'list' | 'exists';

export interface FSInput {
  operation: FSOperation;
  path: string;           // Relative to workspace
  content?: string;       // For write/patch
  patchFind?: string;     // For patch: string to find
  patchReplace?: string;  // For patch: string to replace with
}

export interface FSOutput {
  operation: FSOperation;
  path: string;
  success: boolean;
  content?: string;       // For read
  size?: number;          // For write
  files?: string[];       // For list
  exists?: boolean;       // For exists
}

/**
 * FSTool - File system operations with safety constraints
 * 
 * Features:
 * - Read files
 * - Write files (creates directories as needed)
 * - Patch files (find/replace)
 * - List directory contents
 * - Check if file exists
 * 
 * Security:
 * - No delete operations
 * - Path traversal prevention
 * - Workspace boundary enforcement
 */
export class FSTool {
  private maxFileSize: number;

  constructor(maxFileSize: number = 10 * 1024 * 1024) { // 10MB default
    this.maxFileSize = maxFileSize;
  }

  /**
   * Resolve and validate file path within workspace
   */
  private resolvePath(relativePath: string, workspacePath: string): string {
    const resolvedPath = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(workspacePath, relativePath);

    const normalizedResolved = path.normalize(resolvedPath);
    const normalizedWorkspace = path.normalize(workspacePath);

    // Security: Prevent path traversal
    if (!normalizedResolved.startsWith(normalizedWorkspace)) {
      throw new Error(`PATH_TRAVERSAL: Path "${relativePath}" escapes workspace boundary`);
    }

    return normalizedResolved;
  }

  /**
   * Execute a file system operation
   */
  async execute(input: FSInput, workspacePath: string): Promise<ToolResult> {
    const startTime = Date.now();

    logger.info({ operation: input.operation, path: input.path }, 'Executing FS operation');

    try {
      let result: FSOutput;

      switch (input.operation) {
        case 'read':
          result = await this.handleRead(input, workspacePath);
          break;
        case 'write':
          result = await this.handleWrite(input, workspacePath);
          break;
        case 'patch':
          result = await this.handlePatch(input, workspacePath);
          break;
        case 'list':
          result = await this.handleList(input, workspacePath);
          break;
        case 'exists':
          result = await this.handleExists(input, workspacePath);
          break;
        default:
          result = {
            operation: input.operation,
            path: input.path,
            success: false,
          };
      }

      const duration = Date.now() - startTime;

      logger.info({
        operation: input.operation,
        path: input.path,
        success: result.success,
        duration,
      }, 'FS operation completed');

      return {
        success: result.success,
        output: result,
        duration,
        artifacts: result.success && input.operation === 'write' ? [{
          name: path.basename(input.path),
          path: this.resolvePath(input.path, workspacePath),
          type: this.getMimeType(path.extname(input.path)),
          size: result.size ?? 0,
        }] : undefined,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';

      logger.error({ operation: input.operation, path: input.path, error: message }, 'FS operation failed');

      return {
        success: false,
        output: {
          operation: input.operation,
          path: input.path,
          success: false,
        },
        error: `FS_ERROR: ${message}`,
        duration,
      };
    }
  }

  /**
   * Read file contents
   */
  private async handleRead(input: FSInput, workspacePath: string): Promise<FSOutput> {
    const filePath = this.resolvePath(input.path, workspacePath);
    
    const stats = await fs.stat(filePath);
    if (stats.size > this.maxFileSize) {
      throw new Error(`FILE_TOO_LARGE: File size ${stats.size} exceeds limit ${this.maxFileSize}`);
    }

    const content = await fs.readFile(filePath, 'utf-8');

    return {
      operation: 'read',
      path: input.path,
      success: true,
      content,
      size: stats.size,
    };
  }

  /**
   * Write file contents
   */
  private async handleWrite(input: FSInput, workspacePath: string): Promise<FSOutput> {
    if (!input.content && input.content !== '') {
      throw new Error('WRITE_ERROR: Content is required for write operation');
    }

    const filePath = this.resolvePath(input.path, workspacePath);
    
    // Create directory if needed
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    await fs.writeFile(filePath, input.content, 'utf-8');

    return {
      operation: 'write',
      path: input.path,
      success: true,
      size: input.content.length,
    };
  }

  /**
   * Patch file (find/replace)
   */
  private async handlePatch(input: FSInput, workspacePath: string): Promise<FSOutput> {
    if (!input.patchFind) {
      throw new Error('PATCH_ERROR: patchFind is required for patch operation');
    }

    const filePath = this.resolvePath(input.path, workspacePath);
    
    let content = await fs.readFile(filePath, 'utf-8');

    if (!content.includes(input.patchFind)) {
      throw new Error(`PATCH_ERROR: String "${input.patchFind.substring(0, 50)}..." not found in file`);
    }

    content = content.replace(input.patchFind, input.patchReplace ?? '');

    await fs.writeFile(filePath, content, 'utf-8');

    return {
      operation: 'patch',
      path: input.path,
      success: true,
      size: content.length,
    };
  }

  /**
   * List directory contents
   */
  private async handleList(input: FSInput, workspacePath: string): Promise<FSOutput> {
    const dirPath = this.resolvePath(input.path, workspacePath);
    
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries.map(e => e.isDirectory() ? `${e.name}/` : e.name);

    return {
      operation: 'list',
      path: input.path,
      success: true,
      files,
    };
  }

  /**
   * Check if file/directory exists
   */
  private async handleExists(input: FSInput, workspacePath: string): Promise<FSOutput> {
    const filePath = this.resolvePath(input.path, workspacePath);
    
    try {
      await fs.access(filePath);
      return {
        operation: 'exists',
        path: input.path,
        success: true,
        exists: true,
      };
    } catch {
      return {
        operation: 'exists',
        path: input.path,
        success: true,
        exists: false,
      };
    }
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.js': 'application/javascript',
      '.ts': 'application/typescript',
      '.tsx': 'application/typescript',
      '.jsx': 'application/javascript',
      '.json': 'application/json',
      '.html': 'text/html',
      '.css': 'text/css',
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.py': 'text/x-python',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
    };
    return mimeTypes[ext] || 'text/plain';
  }
}

export const fsTool = new FSTool();
