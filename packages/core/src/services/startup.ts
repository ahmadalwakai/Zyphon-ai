/**
 * Startup Checks Service
 * Validates all required dependencies before worker starts.
 */

import { prisma } from '@zyphon/db';
import { STARTUP_CHECKS, StartupCheckResult, ERROR_CODES } from '@zyphon/shared';
import { ImageTool } from '../tools/image.js';
import { checkPlaywrightBrowsers } from '../tools/browser.js';
import * as pinoModule from 'pino';
import IORedis from 'ioredis';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'startup-checks' });

export interface StartupCheckReport {
  passed: boolean;
  results: StartupCheckResult[];
  criticalFailures: string[];
  warnings: string[];
}

export class StartupService {
  private redisUrl: string;
  private ollamaUrl: string;

  constructor() {
    this.redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';
    this.ollamaUrl = process.env['OLLAMA_URL'] || 'http://localhost:11434';
  }

  /**
   * Run all startup checks
   */
  async runAllChecks(): Promise<StartupCheckReport> {
    const results: StartupCheckResult[] = [];
    const criticalFailures: string[] = [];
    const warnings: string[] = [];

    logger.info('Running startup checks...');

    // Check Database
    const dbCheck = await this.checkDatabase();
    results.push(dbCheck);
    if (!dbCheck.passed && STARTUP_CHECKS.database.critical) {
      criticalFailures.push(dbCheck.message);
    }

    // Check Redis
    const redisCheck = await this.checkRedis();
    results.push(redisCheck);
    if (!redisCheck.passed && STARTUP_CHECKS.redis.critical) {
      criticalFailures.push(redisCheck.message);
    }

    // Check Ollama
    const ollamaCheck = await this.checkOllama();
    results.push(ollamaCheck);
    if (!ollamaCheck.passed && STARTUP_CHECKS.ollama.critical) {
      criticalFailures.push(ollamaCheck.message);
    }

    // Check SD3 Model
    const sd3ModelCheck = await this.checkSD3Model();
    results.push(sd3ModelCheck);
    if (!sd3ModelCheck.passed) {
      if (STARTUP_CHECKS.sd3Model.critical) {
        criticalFailures.push(sd3ModelCheck.message);
      } else {
        warnings.push(sd3ModelCheck.message);
      }
    }

    // Check SD3 Script
    const sd3ScriptCheck = await this.checkSD3Script();
    results.push(sd3ScriptCheck);
    if (!sd3ScriptCheck.passed) {
      if (STARTUP_CHECKS.sd3Script.critical) {
        criticalFailures.push(sd3ScriptCheck.message);
      } else {
        warnings.push(sd3ScriptCheck.message);
      }
    }

    // Check Playwright
    const playwrightCheck = await this.checkPlaywright();
    results.push(playwrightCheck);
    if (!playwrightCheck.passed) {
      if (STARTUP_CHECKS.playwright.critical) {
        criticalFailures.push(playwrightCheck.message);
      } else {
        warnings.push(playwrightCheck.message);
      }
    }

    const passed = criticalFailures.length === 0;

    // Log results
    this.logResults(results, criticalFailures, warnings);

    return {
      passed,
      results,
      criticalFailures,
      warnings,
    };
  }

  /**
   * Check database connection
   */
  private async checkDatabase(): Promise<StartupCheckResult> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        name: STARTUP_CHECKS.database.name,
        passed: true,
        message: 'Database connection OK',
        critical: STARTUP_CHECKS.database.critical,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return {
        name: STARTUP_CHECKS.database.name,
        passed: false,
        message: `${ERROR_CODES.DATABASE_ERROR}: ${msg}`,
        critical: STARTUP_CHECKS.database.critical,
      };
    }
  }

  /**
   * Check Redis connection
   */
  private async checkRedis(): Promise<StartupCheckResult> {
    return new Promise((resolve) => {
      try {
        const Redis = (IORedis as any).default || IORedis;
        const redis = new Redis(this.redisUrl, {
          maxRetriesPerRequest: 1,
          connectTimeout: 5000,
          lazyConnect: true,
        });

        redis.on('error', () => {
          redis.disconnect();
          resolve({
            name: STARTUP_CHECKS.redis.name,
            passed: false,
            message: `${ERROR_CODES.REDIS_NOT_AVAILABLE}: Cannot connect to ${this.redisUrl}`,
            critical: STARTUP_CHECKS.redis.critical,
          });
        });

        redis.connect()
          .then(() => redis.ping())
          .then(() => {
            redis.disconnect();
            resolve({
              name: STARTUP_CHECKS.redis.name,
              passed: true,
              message: `Redis connection OK (${this.redisUrl})`,
              critical: STARTUP_CHECKS.redis.critical,
            });
          })
          .catch((err: Error) => {
            redis.disconnect();
            resolve({
              name: STARTUP_CHECKS.redis.name,
              passed: false,
              message: `${ERROR_CODES.REDIS_NOT_AVAILABLE}: ${err.message}`,
              critical: STARTUP_CHECKS.redis.critical,
            });
          });

        // Timeout
        setTimeout(() => {
          redis.disconnect();
          resolve({
            name: STARTUP_CHECKS.redis.name,
            passed: false,
            message: `${ERROR_CODES.REDIS_NOT_AVAILABLE}: Connection timeout`,
            critical: STARTUP_CHECKS.redis.critical,
          });
        }, 5000);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        resolve({
          name: STARTUP_CHECKS.redis.name,
          passed: false,
          message: `${ERROR_CODES.REDIS_NOT_AVAILABLE}: ${msg}`,
          critical: STARTUP_CHECKS.redis.critical,
        });
      }
    });
  }

  /**
   * Check Ollama LLM availability
   */
  private async checkOllama(): Promise<StartupCheckResult> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return {
          name: STARTUP_CHECKS.ollama.name,
          passed: false,
          message: `${ERROR_CODES.OLLAMA_NOT_AVAILABLE}: HTTP ${response.status}`,
          critical: STARTUP_CHECKS.ollama.critical,
        };
      }

      const data = await response.json() as { models?: Array<{ name: string }> };
      const modelCount = data.models?.length || 0;

      return {
        name: STARTUP_CHECKS.ollama.name,
        passed: true,
        message: `Ollama OK (${modelCount} models available)`,
        critical: STARTUP_CHECKS.ollama.critical,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return {
        name: STARTUP_CHECKS.ollama.name,
        passed: false,
        message: `${ERROR_CODES.OLLAMA_NOT_AVAILABLE}: ${msg}`,
        critical: STARTUP_CHECKS.ollama.critical,
      };
    }
  }

  /**
   * Check SD3 model path
   */
  private async checkSD3Model(): Promise<StartupCheckResult> {
    const imageTool = new ImageTool();
    const status = imageTool.getConfigStatus();

    if (!status.modelPath) {
      return {
        name: STARTUP_CHECKS.sd3Model.name,
        passed: false,
        message: `${ERROR_CODES.SD3_NOT_CONFIGURED}: SD3_MODEL_PATH not set`,
        critical: STARTUP_CHECKS.sd3Model.critical,
      };
    }

    const availability = await imageTool.isAvailable();

    if (!availability.available && availability.error?.includes('Model not found')) {
      return {
        name: STARTUP_CHECKS.sd3Model.name,
        passed: false,
        message: `${ERROR_CODES.SD3_MODEL_NOT_FOUND}: ${status.modelPath}`,
        critical: STARTUP_CHECKS.sd3Model.critical,
      };
    }

    return {
      name: STARTUP_CHECKS.sd3Model.name,
      passed: true,
      message: `SD3 model OK (${status.modelPath.split(/[\\/]/).pop()})`,
      critical: STARTUP_CHECKS.sd3Model.critical,
    };
  }

  /**
   * Check SD3 script path
   */
  private async checkSD3Script(): Promise<StartupCheckResult> {
    const imageTool = new ImageTool();
    const status = imageTool.getConfigStatus();

    if (!status.scriptPath) {
      return {
        name: STARTUP_CHECKS.sd3Script.name,
        passed: false,
        message: `${ERROR_CODES.SD3_NOT_CONFIGURED}: SD3_SCRIPT_PATH not set`,
        critical: STARTUP_CHECKS.sd3Script.critical,
      };
    }

    const availability = await imageTool.isAvailable();

    if (!availability.available && availability.error?.includes('Script not found')) {
      return {
        name: STARTUP_CHECKS.sd3Script.name,
        passed: false,
        message: `${ERROR_CODES.SD3_SCRIPT_NOT_FOUND}: ${status.scriptPath}`,
        critical: STARTUP_CHECKS.sd3Script.critical,
      };
    }

    return {
      name: STARTUP_CHECKS.sd3Script.name,
      passed: true,
      message: `SD3 script OK (${status.scriptPath.split(/[\\/]/).pop()})`,
      critical: STARTUP_CHECKS.sd3Script.critical,
    };
  }

  /**
   * Check Playwright browsers
   */
  private async checkPlaywright(): Promise<StartupCheckResult> {
    const error = await checkPlaywrightBrowsers();

    if (error) {
      return {
        name: STARTUP_CHECKS.playwright.name,
        passed: false,
        message: `${ERROR_CODES.PLAYWRIGHT_NOT_INSTALLED}: ${error.installCommand}`,
        critical: STARTUP_CHECKS.playwright.critical,
      };
    }

    return {
      name: STARTUP_CHECKS.playwright.name,
      passed: true,
      message: 'Playwright browsers OK',
      critical: STARTUP_CHECKS.playwright.critical,
    };
  }

  /**
   * Log formatted results
   */
  private logResults(
    results: StartupCheckResult[],
    criticalFailures: string[],
    warnings: string[]
  ): void {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                        ZYPHON STARTUP CHECKS                              ║');
    console.log('╠═══════════════════════════════════════════════════════════════════════════╣');

    for (const result of results) {
      const icon = result.passed ? '✓' : (result.critical ? '✗' : '⚠');
      const status = result.passed ? 'OK' : (result.critical ? 'FAIL' : 'WARN');
      const line = `║  ${icon} ${result.name.padEnd(25)} ${status.padEnd(6)} ${result.message.substring(0, 38).padEnd(38)}║`;
      console.log(line);
    }

    console.log('╠═══════════════════════════════════════════════════════════════════════════╣');

    if (criticalFailures.length > 0) {
      console.log('║  CRITICAL FAILURES:                                                       ║');
      for (const failure of criticalFailures) {
        console.log(`║    • ${failure.substring(0, 67).padEnd(69)}║`);
      }
    }

    if (warnings.length > 0) {
      console.log('║  WARNINGS:                                                                ║');
      for (const warning of warnings) {
        console.log(`║    • ${warning.substring(0, 67).padEnd(69)}║`);
      }
    }

    if (criticalFailures.length === 0 && warnings.length === 0) {
      console.log('║  All checks passed! Worker is ready.                                      ║');
    }

    console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
    console.log('\n');
  }
}

export const startupService = new StartupService();
