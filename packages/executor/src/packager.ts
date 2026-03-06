/**
 * Packager — zips the virtual file system into a downloadable archive.
 * Uses archiver to create zip files stored in /tmp.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import archiver from 'archiver';
import { VirtualFS } from './virtual-fs.js';

export interface PackageResult {
  zipPath: string;
  sizeBytes: number;
  fileCount: number;
}

export class Packager {
  /**
   * Package a VirtualFS into a zip file.
   * Returns the path to the zip file and metadata.
   */
  static async package(
    vfs: VirtualFS,
    taskId: string,
    projectName: string = 'project'
  ): Promise<PackageResult> {
    const zipDir = path.join(os.tmpdir(), 'zyphon-outputs');
    if (!fs.existsSync(zipDir)) {
      fs.mkdirSync(zipDir, { recursive: true });
    }

    const zipPath = path.join(zipDir, `${taskId}-${projectName}.zip`);
    const files = vfs.getAllFiles();

    if (files.length === 0) {
      throw new Error('No files to package');
    }

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      for (const file of files) {
        // Remove leading slash for archive paths
        const archivePath = file.path.startsWith('/')
          ? file.path.substring(1)
          : file.path;
        archive.append(file.content, { name: `${projectName}/${archivePath}` });
      }

      archive.finalize().catch(reject);
    });

    const stat = fs.statSync(zipPath);

    return {
      zipPath,
      sizeBytes: stat.size,
      fileCount: files.length,
    };
  }

  /**
   * Read zip file as base64 string for download.
   */
  static readAsBase64(zipPath: string): string {
    return fs.readFileSync(zipPath).toString('base64');
  }

  /**
   * Read zip file as Buffer for streaming.
   */
  static readAsBuffer(zipPath: string): Buffer {
    return fs.readFileSync(zipPath);
  }

  /**
   * Remove a zip file after download.
   */
  static cleanup(zipPath: string): void {
    try {
      fs.unlinkSync(zipPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
