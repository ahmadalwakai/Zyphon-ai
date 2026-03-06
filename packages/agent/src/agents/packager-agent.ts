/**
 * Packager Agent — Zips the final virtual file system and returns a download URL.
 */

import type { Sandbox } from '@zyphon/executor';
import { Packager, type PackageResult } from '@zyphon/executor';
import type { GroqStreamCallback } from '../llm/groq-client.js';

export class PackagerAgent {
  /**
   * Package the sandbox into a downloadable zip.
   */
  async package(
    sandbox: Sandbox,
    projectName: string,
    onLog?: GroqStreamCallback
  ): Promise<PackageResult> {
    onLog?.({
      type: 'token',
      content: '\n📦 Packaging project...\n',
      stage: 'packaging',
    });

    const files = sandbox.listFiles();

    if (files.length === 0) {
      throw new Error('No files to package — the project is empty');
    }

    onLog?.({
      type: 'token',
      content: `Found ${files.length} files to package:\n${files.map((f: string) => `  ${f}`).join('\n')}\n`,
      stage: 'packaging',
    });

    const result = await sandbox.package(projectName);

    onLog?.({
      type: 'done',
      content: `✓ Project packaged: ${result.fileCount} files, ${(result.sizeBytes / 1024).toFixed(1)}KB\n`,
      stage: 'packaging',
    });

    return result;
  }

  /**
   * Read the packaged zip as base64 for API response.
   */
  readAsBase64(zipPath: string): string {
    return Packager.readAsBase64(zipPath);
  }

  /**
   * Read the packaged zip as buffer for streaming download.
   */
  readAsBuffer(zipPath: string): Buffer {
    return Packager.readAsBuffer(zipPath);
  }
}
