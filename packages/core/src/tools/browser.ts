import path from 'path';
import fs from 'fs/promises';
import {
  ToolResult,
  BrowserInput,
  BrowserOutput,
  BrowserAction,
  BROWSER_TIMEOUT_MS,
} from '@zyphon/shared';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'browser-tool' });

// Structured error for missing Playwright browsers
export interface PlaywrightMissingError {
  code: 'PLAYWRIGHT_BROWSERS_MISSING';
  message: string;
  installCommand: string;
  platform: string;
}

export function createPlaywrightMissingError(): PlaywrightMissingError {
  return {
    code: 'PLAYWRIGHT_BROWSERS_MISSING',
    message: 'Playwright browsers are not installed. Please install them before running browser automation.',
    installCommand: 'pnpm run playwright:install',
    platform: process.platform,
  };
}

// Lazy load playwright to avoid requiring it when not needed
let playwright: typeof import('playwright') | null = null;
let browser: import('playwright').Browser | null = null;
let browserCheckError: PlaywrightMissingError | null = null;

async function getPlaywright() {
  if (!playwright) {
    try {
      playwright = await import('playwright');
    } catch (error) {
      browserCheckError = createPlaywrightMissingError();
      throw new Error(
        'Playwright is not installed. Run: pnpm run playwright:install'
      );
    }
  }
  return playwright;
}

async function getBrowser(): Promise<import('playwright').Browser> {
  if (!browser) {
    const pw = await getPlaywright();
    try {
      browser = await pw.chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // Check if it's a browser executable missing error
      if (errMsg.includes('Executable doesn\'t exist') || 
          errMsg.includes('browserType.launch') ||
          errMsg.includes('chromium') ||
          errMsg.includes('Failed to launch')) {
        browserCheckError = createPlaywrightMissingError();
        throw new Error(JSON.stringify(browserCheckError));
      }
      throw error;
    }
  }
  return browser;
}

/**
 * Check if Playwright browsers are installed.
 * Returns null if OK, or PlaywrightMissingError if not installed.
 */
export async function checkPlaywrightBrowsers(): Promise<PlaywrightMissingError | null> {
  if (browserCheckError) return browserCheckError;
  
  try {
    const pw = await getPlaywright();
    const testBrowser = await pw.chromium.launch({ headless: true });
    await testBrowser.close();
    return null;
  } catch (error) {
    browserCheckError = createPlaywrightMissingError();
    return browserCheckError;
  }
}

/**
 * BrowserTool - Headless browser automation using Playwright
 * 
 * Features:
 * - Navigate to URLs
 * - Click elements
 * - Type text
 * - Take screenshots
 * - Wait for network idle
 * - Wait for selectors
 */
export class BrowserTool {
  private timeout: number;

  constructor(timeout: number = BROWSER_TIMEOUT_MS) {
    this.timeout = timeout;
  }

  /**
   * Execute a browser action
   */
  async execute(input: BrowserInput, workspacePath: string): Promise<ToolResult> {
    const startTime = Date.now();

    logger.info({ action: input.action, url: input.url, selector: input.selector }, 'Executing browser action');

    try {
      // Check for Playwright browsers first
      const browserError = await checkPlaywrightBrowsers();
      if (browserError) {
        return {
          success: false,
          output: browserError,
          error: `PLAYWRIGHT_BROWSERS_MISSING: ${browserError.message}\nRun: ${browserError.installCommand}`,
          duration: Date.now() - startTime,
        };
      }

      const browserInstance = await getBrowser();
      const context = await browserInstance.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Zyphon-Agent/1.0',
      });

      const page = await context.newPage();
      const timeout = input.timeout ?? this.timeout;

      page.setDefaultTimeout(timeout);

      let result: BrowserOutput;

      switch (input.action) {
        case 'goto':
          result = await this.handleGoto(page, input, workspacePath);
          break;
        case 'click':
          result = await this.handleClick(page, input);
          break;
        case 'type':
          result = await this.handleType(page, input);
          break;
        case 'screenshot':
          result = await this.handleScreenshot(page, input, workspacePath);
          break;
        case 'waitForNetworkIdle':
          result = await this.handleWaitForNetworkIdle(page);
          break;
        case 'waitForSelector':
          result = await this.handleWaitForSelector(page, input);
          break;
        default:
          result = {
            success: false,
            action: input.action,
            error: `Unknown action: ${input.action}`,
            duration: Date.now() - startTime,
          };
      }

      await context.close();

      result.duration = Date.now() - startTime;

      // Save action log
      await this.saveActionLog(workspacePath, input, result);

      logger.info({
        action: input.action,
        success: result.success,
        duration: result.duration,
      }, 'Browser action completed');

      // Build artifact metadata if screenshot was taken
      const artifacts = result.screenshotPath ? [{
        name: path.basename(result.screenshotPath),
        path: result.screenshotPath,
        type: 'image/png',
        size: result.metadata?.fileSize || 0,
        timestamp: result.metadata?.timestamp || new Date().toISOString(),
        url: result.url || result.metadata?.url,
      }] : undefined;

      return {
        success: result.success,
        output: result,
        error: result.error,
        duration: result.duration,
        artifacts,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error({ action: input.action, error: message }, 'Browser action failed');

      return {
        success: false,
        output: {
          success: false,
          action: input.action,
          error: message,
          duration,
        },
        error: `BROWSER_ERROR: ${message}`,
        duration,
      };
    }
  }

  /**
   * Navigate to URL and optionally take screenshot
   */
  private async handleGoto(
    page: import('playwright').Page,
    input: BrowserInput,
    workspacePath: string
  ): Promise<BrowserOutput> {
    if (!input.url) {
      return {
        success: false,
        action: 'goto',
        error: 'URL is required for goto action',
        duration: 0,
      };
    }

    await page.goto(input.url, { waitUntil: 'networkidle' });
    
    const title = await page.title();
    const timestamp = new Date().toISOString();
    
    // Take screenshot after navigation
    const screenshotName = input.screenshotName || `goto_${Date.now()}`;
    const screenshotPath = await this.takeScreenshot(
      page,
      workspacePath,
      screenshotName
    );

    // Get file stats for artifact metadata
    let fileSize = 0;
    try {
      const stats = await fs.stat(screenshotPath);
      fileSize = stats.size;
    } catch {}

    return {
      success: true,
      action: 'goto',
      url: input.url,
      screenshotPath,
      duration: 0,
      metadata: {
        title,
        viewport: { width: 1920, height: 1080 },
        timestamp,
        fileName: `${screenshotName}.png`,
        fileSize,
      },
    };
  }

  /**
   * Click an element
   */
  private async handleClick(
    page: import('playwright').Page,
    input: BrowserInput
  ): Promise<BrowserOutput> {
    if (!input.selector) {
      return {
        success: false,
        action: 'click',
        error: 'Selector is required for click action',
        duration: 0,
      };
    }

    await page.click(input.selector);

    return {
      success: true,
      action: 'click',
      duration: 0,
    };
  }

  /**
   * Type text into an element
   */
  private async handleType(
    page: import('playwright').Page,
    input: BrowserInput
  ): Promise<BrowserOutput> {
    if (!input.selector) {
      return {
        success: false,
        action: 'type',
        error: 'Selector is required for type action',
        duration: 0,
      };
    }

    if (!input.text) {
      return {
        success: false,
        action: 'type',
        error: 'Text is required for type action',
        duration: 0,
      };
    }

    await page.fill(input.selector, input.text);

    return {
      success: true,
      action: 'type',
      duration: 0,
    };
  }

  /**
   * Take a screenshot
   */
  private async handleScreenshot(
    page: import('playwright').Page,
    input: BrowserInput,
    workspacePath: string
  ): Promise<BrowserOutput> {
    const screenshotName = input.screenshotName || `screenshot_${Date.now()}`;
    const screenshotPath = await this.takeScreenshot(
      page,
      workspacePath,
      screenshotName
    );

    const timestamp = new Date().toISOString();
    let fileSize = 0;
    try {
      const stats = await fs.stat(screenshotPath);
      fileSize = stats.size;
    } catch {}

    return {
      success: true,
      action: 'screenshot',
      screenshotPath,
      duration: 0,
      metadata: {
        url: page.url(),
        timestamp,
        fileName: `${screenshotName}.png`,
        fileSize,
      },
    };
  }

  /**
   * Wait for network to be idle
   */
  private async handleWaitForNetworkIdle(
    page: import('playwright').Page
  ): Promise<BrowserOutput> {
    await page.waitForLoadState('networkidle');

    return {
      success: true,
      action: 'waitForNetworkIdle',
      duration: 0,
    };
  }

  /**
   * Wait for a selector to appear
   */
  private async handleWaitForSelector(
    page: import('playwright').Page,
    input: BrowserInput
  ): Promise<BrowserOutput> {
    if (!input.selector) {
      return {
        success: false,
        action: 'waitForSelector',
        error: 'Selector is required for waitForSelector action',
        duration: 0,
      };
    }

    await page.waitForSelector(input.selector);

    return {
      success: true,
      action: 'waitForSelector',
      duration: 0,
    };
  }

  /**
   * Take screenshot and save to workspace
   */
  private async takeScreenshot(
    page: import('playwright').Page,
    workspacePath: string,
    name: string
  ): Promise<string> {
    const browserDir = path.join(workspacePath, 'outputs', 'browser');
    await fs.mkdir(browserDir, { recursive: true });

    const screenshotPath = path.join(browserDir, `${name}.png`);
    
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    // Also save metadata
    const metadataPath = path.join(browserDir, `${name}.json`);
    await fs.writeFile(metadataPath, JSON.stringify({
      screenshotPath,
      url: page.url(),
      title: await page.title(),
      timestamp: new Date().toISOString(),
    }, null, 2));

    return screenshotPath;
  }

  /**
   * Save action log to workspace
   */
  private async saveActionLog(
    workspacePath: string,
    input: BrowserInput,
    result: BrowserOutput
  ): Promise<void> {
    try {
      const logsDir = path.join(workspacePath, 'logs', 'browser');
      await fs.mkdir(logsDir, { recursive: true });

      const logFile = path.join(logsDir, `action_${Date.now()}.json`);
      await fs.writeFile(logFile, JSON.stringify({
        input,
        result,
        timestamp: new Date().toISOString(),
      }, null, 2));
    } catch (error) {
      logger.warn({ error }, 'Failed to save browser action log');
    }
  }

  /**
   * Close browser instance (for cleanup)
   */
  static async closeBrowser(): Promise<void> {
    if (browser) {
      await browser.close();
      browser = null;
    }
  }
}

export const browserTool = new BrowserTool();
