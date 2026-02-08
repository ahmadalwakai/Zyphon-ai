import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { ToolResult, SD3_CONFIG, ERROR_CODES } from '@zyphon/shared';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'image-tool' });

export interface ImageToolInput {
  prompt: string;
  outputPath: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  negativePrompt?: string;
}

export interface ImageMetadata {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps: number;
  seed?: number;
  generatedAt: string;
  duration: number;
  filePath: string;
  fileSize: number;
  modelPath: string;
}

export class ImageTool {
  private scriptPath: string;
  private modelPath: string;
  private timeout: number;
  private configured: boolean;
  private configError: string | null;

  constructor(
    scriptPath: string = process.env['SD3_SCRIPT_PATH'] || '',
    modelPath: string = process.env['SD3_MODEL_PATH'] || '',
    timeout: number = SD3_CONFIG.timeoutMs
  ) {
    this.scriptPath = scriptPath;
    this.modelPath = modelPath;
    this.timeout = timeout;
    
    // Pre-validate configuration
    const validation = this.validateConfiguration();
    this.configured = validation.valid;
    this.configError = validation.error || null;
    
    if (!this.configured) {
      logger.warn({ error: this.configError }, 'SD3 not configured - image generation will fail');
    }
  }

  /**
   * Validate SD3 configuration
   */
  private validateConfiguration(): { valid: boolean; error?: string } {
    if (!this.scriptPath) {
      return {
        valid: false,
        error: `${ERROR_CODES.SD3_NOT_CONFIGURED}: SD3_SCRIPT_PATH environment variable not set`,
      };
    }
    
    if (!this.modelPath) {
      return {
        valid: false,
        error: `${ERROR_CODES.SD3_NOT_CONFIGURED}: SD3_MODEL_PATH environment variable not set`,
      };
    }
    
    return { valid: true };
  }

  /**
   * Check if SD3 script exists on disk
   */
  private async checkScriptExists(): Promise<boolean> {
    try {
      await fs.access(this.scriptPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if SD3 model exists on disk
   */
  private async checkModelExists(): Promise<boolean> {
    try {
      await fs.access(this.modelPath);
      return true;
    } catch {
      return false;
    }
  }

  async generate(input: ImageToolInput, retryCount: number = 0): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // FAIL FAST: Require SD3 configuration
      if (!this.configured) {
        logger.error({ error: this.configError }, 'SD3 not configured - failing task');
        return {
          success: false,
          output: null,
          error: this.configError || `${ERROR_CODES.SD3_NOT_CONFIGURED}: SD3 configuration missing`,
          duration: Date.now() - startTime,
        };
      }

      // Validate script exists
      const scriptExists = await this.checkScriptExists();
      if (!scriptExists) {
        const error = `${ERROR_CODES.SD3_SCRIPT_NOT_FOUND}: Script not found at ${this.scriptPath}`;
        logger.error({ scriptPath: this.scriptPath }, error);
        return {
          success: false,
          output: null,
          error,
          duration: Date.now() - startTime,
        };
      }

      // Validate model exists
      const modelExists = await this.checkModelExists();
      if (!modelExists) {
        const error = `${ERROR_CODES.SD3_MODEL_NOT_FOUND}: Model not found at ${this.modelPath}`;
        logger.error({ modelPath: this.modelPath }, error);
        return {
          success: false,
          output: null,
          error,
          duration: Date.now() - startTime,
        };
      }

      // Validate and constrain dimensions
      const width = this.constrainDimension(input.width ?? SD3_CONFIG.defaultWidth, SD3_CONFIG.supportedWidths);
      const height = this.constrainDimension(input.height ?? SD3_CONFIG.defaultHeight, SD3_CONFIG.supportedHeights);
      const steps = Math.max(SD3_CONFIG.minSteps, Math.min(SD3_CONFIG.maxSteps, input.steps ?? SD3_CONFIG.defaultSteps));

      // Ensure output directory exists
      const outputDir = path.dirname(input.outputPath);
      await fs.mkdir(outputDir, { recursive: true });

      logger.info({ 
        prompt: input.prompt.substring(0, 100), 
        outputPath: input.outputPath,
        width,
        height,
        steps,
        seed: input.seed,
      }, 'Starting SD3 image generation');

      // Run SD3 script
      await this.runPythonScript({
        prompt: input.prompt,
        outputPath: input.outputPath,
        width,
        height,
        steps,
        seed: input.seed,
        negativePrompt: input.negativePrompt,
      });

      const duration = Date.now() - startTime;

      // Verify output file exists
      try {
        await fs.access(input.outputPath);
      } catch {
        throw new Error(`${ERROR_CODES.SD3_GENERATION_FAILED}: Output file not created`);
      }

      // Get file stats
      const stats = await fs.stat(input.outputPath);

      const metadata: ImageMetadata = {
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        width,
        height,
        steps,
        seed: input.seed,
        generatedAt: new Date().toISOString(),
        duration,
        filePath: input.outputPath,
        fileSize: stats.size,
        modelPath: this.modelPath,
      };

      // Save metadata alongside image
      const metadataPath = input.outputPath.replace(/\.[^.]+$/, '.json');
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      logger.info({ duration, fileSize: stats.size, outputPath: input.outputPath }, 'SD3 image generation completed');

      return {
        success: true,
        output: metadata,
        duration,
        artifacts: [
          {
            name: path.basename(input.outputPath),
            path: input.outputPath,
            type: 'image/png',
            size: stats.size,
          },
          {
            name: path.basename(metadataPath),
            path: metadataPath,
            type: 'application/json',
            size: JSON.stringify(metadata).length,
          },
        ],
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, duration }, 'SD3 image generation failed');

      // Retry once on failure (if not already retrying)
      if (retryCount < SD3_CONFIG.maxRetries) {
        logger.info({ retryCount: retryCount + 1 }, 'Retrying SD3 image generation');
        return this.generate(input, retryCount + 1);
      }

      return {
        success: false,
        output: null,
        error: `${ERROR_CODES.SD3_GENERATION_FAILED}: ${message}`,
        duration,
      };
    }
  }

  /**
   * Constrain dimension to nearest supported value
   */
  private constrainDimension(value: number, supported: readonly number[]): number {
    return supported.reduce((prev, curr) =>
      Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
    );
  }

  private runPythonScript(input: ImageToolInput & { width: number; height: number; steps: number }): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        this.scriptPath,
        '--prompt', input.prompt,
        '--output', input.outputPath,
        '--width', String(input.width),
        '--height', String(input.height),
        '--steps', String(input.steps),
        '--model', this.modelPath,
      ];

      if (input.negativePrompt) {
        args.push('--negative', input.negativePrompt);
      }

      if (input.seed !== undefined) {
        args.push('--seed', String(input.seed));
      }

      logger.debug({ args }, 'Running SD3 Python script');

      const process = spawn('python', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: this.timeout,
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
        logger.debug({ stdout: data.toString().trim() }, 'SD3 stdout');
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
        logger.debug({ stderr: data.toString().trim() }, 'SD3 stderr');
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SD3 script failed with code ${code}: ${stderr || stdout}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Check if SD3 is properly configured and available
   */
  async isAvailable(): Promise<{ available: boolean; error?: string }> {
    if (!this.configured) {
      return { available: false, error: this.configError || 'SD3 not configured' };
    }

    const scriptExists = await this.checkScriptExists();
    if (!scriptExists) {
      return { available: false, error: `Script not found: ${this.scriptPath}` };
    }

    const modelExists = await this.checkModelExists();
    if (!modelExists) {
      return { available: false, error: `Model not found: ${this.modelPath}` };
    }

    return { available: true };
  }

  /**
   * Get configuration status for startup checks
   */
  getConfigStatus(): { configured: boolean; scriptPath: string; modelPath: string; error?: string } {
    return {
      configured: this.configured,
      scriptPath: this.scriptPath,
      modelPath: this.modelPath,
      error: this.configError || undefined,
    };
  }
}

export const imageTool = new ImageTool();
