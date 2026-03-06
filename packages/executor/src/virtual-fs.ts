/**
 * Virtual File System — in-memory file system backed by memfs.
 * Provides read/write/list operations for sandboxed code generation.
 */

import { Volume, createFsFromVolume } from 'memfs';
import type { FileEntry } from './types.js';

export class VirtualFS {
  private vol: InstanceType<typeof Volume>;
  private fs: ReturnType<typeof createFsFromVolume>;

  constructor() {
    this.vol = new Volume();
    this.fs = createFsFromVolume(this.vol);
  }

  /**
   * Write a file to the virtual file system.
   * Creates intermediate directories automatically.
   */
  writeFile(filePath: string, content: string): void {
    const normalized = filePath.startsWith('/') ? filePath : `/${filePath}`;
    const dir = normalized.substring(0, normalized.lastIndexOf('/'));
    if (dir && dir !== '/') {
      this.fs.mkdirSync(dir, { recursive: true });
    }
    this.fs.writeFileSync(normalized, content);
  }

  /**
   * Read a file from the virtual file system.
   */
  readFile(filePath: string): string {
    const normalized = filePath.startsWith('/') ? filePath : `/${filePath}`;
    return this.fs.readFileSync(normalized, 'utf-8') as string;
  }

  /**
   * Check if a file exists in the virtual file system.
   */
  exists(filePath: string): boolean {
    const normalized = filePath.startsWith('/') ? filePath : `/${filePath}`;
    try {
      this.fs.statSync(normalized);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all files in the virtual file system recursively.
   */
  listFiles(dir: string = '/'): string[] {
    const results: string[] = [];
    this._walkDir(dir, results);
    return results;
  }

  private _walkDir(dir: string, results: string[]): void {
    try {
      const entries = this.fs.readdirSync(dir) as string[];
      for (const entry of entries) {
        const fullPath = dir === '/' ? `/${entry}` : `${dir}/${entry}`;
        try {
          const stat = this.fs.statSync(fullPath);
          if (stat.isDirectory()) {
            this._walkDir(fullPath, results);
          } else {
            results.push(fullPath);
          }
        } catch {
          // skip inaccessible entries
        }
      }
    } catch {
      // directory doesn't exist
    }
  }

  /**
   * Get all files as an array of FileEntry objects.
   */
  getAllFiles(): FileEntry[] {
    const paths = this.listFiles();
    return paths.map(p => ({
      path: p,
      content: this.readFile(p),
    }));
  }

  /**
   * Delete a file from the virtual file system.
   */
  deleteFile(filePath: string): void {
    const normalized = filePath.startsWith('/') ? filePath : `/${filePath}`;
    try {
      this.fs.unlinkSync(normalized);
    } catch {
      // file doesn't exist, ignore
    }
  }

  /**
   * Materialize the virtual file system to a real directory.
   * Used before command execution and packaging.
   */
  async materialize(targetDir: string): Promise<void> {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const files = this.getAllFiles();
    for (const file of files) {
      const fullPath = path.join(targetDir, file.path);
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, file.content, 'utf-8');
    }
  }

  /**
   * Get file count.
   */
  get fileCount(): number {
    return this.listFiles().length;
  }

  /**
   * Get the underlying volume for archiver compatibility.
   */
  getVolume(): InstanceType<typeof Volume> {
    return this.vol;
  }
}
