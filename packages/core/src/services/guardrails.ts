/**
 * Guardrails Service
 * Enforces all safety limits at the system level.
 */

import { prisma } from '@zyphon/db';
import {
  AGENT_LIMITS,
  RATE_LIMITS,
  TERMINAL_GUARDRAILS,
  BROWSER_GUARDRAILS,
  ERROR_CODES,
  isCommandAllowed,
  isDomainAllowed,
  PLAN_LIMITS,
} from '@zyphon/shared';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'guardrails' });

// Rate limit tracking (in-memory, could be Redis for multi-worker)
const rateLimitStore = new Map<string, { tasks: number[]; requests: number[] }>();

export interface GuardrailCheck {
  allowed: boolean;
  error?: string;
  code?: string;
}

export class GuardrailsService {
  /**
   * Check if a terminal command is allowed
   */
  checkTerminalCommand(command: string): GuardrailCheck {
    const result = isCommandAllowed(command);
    if (!result.allowed) {
      logger.warn({ command: command.substring(0, 100) }, 'Terminal command blocked');
      return {
        allowed: false,
        error: result.error,
        code: result.error?.includes('BLOCKED') ? ERROR_CODES.COMMAND_BLOCKED : ERROR_CODES.COMMAND_NOT_ALLOWED,
      };
    }
    return { allowed: true };
  }

  /**
   * Check if a browser URL is allowed
   */
  checkBrowserUrl(url: string, requestedDomains: string[] = []): GuardrailCheck {
    if (!url) {
      return { allowed: false, error: 'URL is required', code: ERROR_CODES.DOMAIN_NOT_ALLOWED };
    }

    if (isDomainAllowed(url, requestedDomains)) {
      return { allowed: true };
    }

    logger.warn({ url }, 'Browser URL blocked - domain not allowed');
    return {
      allowed: false,
      error: `${ERROR_CODES.DOMAIN_NOT_ALLOWED}: URL ${url} is not in allowed domains`,
      code: ERROR_CODES.DOMAIN_NOT_ALLOWED,
    };
  }

  /**
   * Check agent limits for a task
   */
  async checkAgentLimits(
    userId: string,
    currentStepCount: number,
    elapsedSeconds: number
  ): Promise<GuardrailCheck> {
    // Check step limit
    if (currentStepCount >= AGENT_LIMITS.maxStepsPerTask) {
      logger.warn({ userId, currentStepCount }, 'Step limit exceeded');
      return {
        allowed: false,
        error: `${ERROR_CODES.MAX_STEPS_EXCEEDED}: Maximum ${AGENT_LIMITS.maxStepsPerTask} steps allowed`,
        code: ERROR_CODES.MAX_STEPS_EXCEEDED,
      };
    }

    // Check time limit
    if (elapsedSeconds >= AGENT_LIMITS.maxWallClockSeconds) {
      logger.warn({ userId, elapsedSeconds }, 'Time limit exceeded');
      return {
        allowed: false,
        error: `${ERROR_CODES.MAX_TIME_EXCEEDED}: Maximum ${AGENT_LIMITS.maxWallClockSeconds} seconds allowed`,
        code: ERROR_CODES.MAX_TIME_EXCEEDED,
      };
    }

    return { allowed: true };
  }

  /**
   * Check concurrent task limit for a user
   */
  async checkConcurrentTasks(userId: string): Promise<GuardrailCheck> {
    try {
      // Get user's plan
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { plan: true },
      });

      const planConfig = PLAN_LIMITS[(user?.plan as keyof typeof PLAN_LIMITS) || 'FREE'];
      const maxConcurrent = planConfig.maxConcurrentTasks;

      // Count running tasks
      const runningTasks = await prisma.userTask.count({
        where: {
          workspace: { userId },
          status: { in: ['QUEUED', 'PLANNED', 'RUNNING'] },
        },
      });

      if (runningTasks >= maxConcurrent) {
        logger.warn({ userId, runningTasks, maxConcurrent }, 'Concurrent task limit reached');
        return {
          allowed: false,
          error: `${ERROR_CODES.MAX_CONCURRENT_TASKS_EXCEEDED}: Maximum ${maxConcurrent} concurrent tasks allowed`,
          code: ERROR_CODES.MAX_CONCURRENT_TASKS_EXCEEDED,
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error({ userId, error }, 'Failed to check concurrent tasks');
      return { allowed: true }; // Fail open to avoid blocking legitimate tasks
    }
  }

  /**
   * Check rate limits for task creation
   */
  checkTaskRateLimit(userId: string): GuardrailCheck {
    const now = Date.now();
    const minuteAgo = now - 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    // Get or create rate limit entry
    let entry = rateLimitStore.get(userId);
    if (!entry) {
      entry = { tasks: [], requests: [] };
      rateLimitStore.set(userId, entry);
    }

    // Clean old entries
    entry.tasks = entry.tasks.filter(t => t > dayAgo);
    entry.requests = entry.requests.filter(r => r > minuteAgo);

    // Check minute limit
    const tasksLastMinute = entry.tasks.filter(t => t > minuteAgo).length;
    if (tasksLastMinute >= RATE_LIMITS.tasksPerMinute) {
      logger.warn({ userId, tasksLastMinute }, 'Task rate limit (per minute) exceeded');
      return {
        allowed: false,
        error: `Rate limit exceeded: Maximum ${RATE_LIMITS.tasksPerMinute} tasks per minute`,
        code: 'RATE_LIMIT_EXCEEDED',
      };
    }

    // Check day limit
    const tasksLastDay = entry.tasks.length;
    if (tasksLastDay >= RATE_LIMITS.tasksPerDay) {
      logger.warn({ userId, tasksLastDay }, 'Task rate limit (per day) exceeded');
      return {
        allowed: false,
        error: `Rate limit exceeded: Maximum ${RATE_LIMITS.tasksPerDay} tasks per day`,
        code: 'RATE_LIMIT_EXCEEDED',
      };
    }

    // Record this task
    entry.tasks.push(now);

    return { allowed: true };
  }

  /**
   * Check for abuse patterns
   */
  async detectAbuse(userId: string): Promise<{ flagged: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    const now = new Date();

    try {
      // Check task spam
      const spamWindow = new Date(now.getTime() - RATE_LIMITS.abuseThresholds.taskSpamMinutes * 60 * 1000);
      const recentTasks = await prisma.userTask.count({
        where: {
          workspace: { userId },
          createdAt: { gte: spamWindow },
        },
      });

      if (recentTasks >= RATE_LIMITS.abuseThresholds.taskSpamTasks) {
        reasons.push(`Task spam: ${recentTasks} tasks in ${RATE_LIMITS.abuseThresholds.taskSpamMinutes} minutes`);
      }

      // Check long-running tasks
      const longRunThreshold = new Date(now.getTime() - RATE_LIMITS.abuseThresholds.longRunMinutes * 60 * 1000);
      const longRunningTasks = await prisma.userTask.count({
        where: {
          workspace: { userId },
          status: 'RUNNING',
          startedAt: { lte: longRunThreshold },
        },
      });

      if (longRunningTasks > 0) {
        reasons.push(`Long-running tasks: ${longRunningTasks} tasks running > ${RATE_LIMITS.abuseThresholds.longRunMinutes} minutes`);
      }

      // Check failed tasks
      const failWindow = new Date(now.getTime() - RATE_LIMITS.abuseThresholds.failedTasksMinutes * 60 * 1000);
      const failedTasks = await prisma.userTask.count({
        where: {
          workspace: { userId },
          status: 'FAILED',
          completedAt: { gte: failWindow },
        },
      });

      if (failedTasks >= RATE_LIMITS.abuseThresholds.failedTasksCount) {
        reasons.push(`High failure rate: ${failedTasks} failed tasks in ${RATE_LIMITS.abuseThresholds.failedTasksMinutes} minutes`);
      }

      if (reasons.length > 0) {
        logger.warn({ userId, reasons }, 'Abuse patterns detected');
      }

      return {
        flagged: reasons.length > 0,
        reasons,
      };
    } catch (error) {
      logger.error({ userId, error }, 'Failed to detect abuse');
      return { flagged: false, reasons: [] };
    }
  }

  /**
   * Admin kill-switch: cancel all tasks for a user
   */
  async killUserTasks(userId: string, reason: string): Promise<number> {
    try {
      const result = await prisma.userTask.updateMany({
        where: {
          workspace: { userId },
          status: { in: ['QUEUED', 'PLANNED', 'RUNNING'] },
        },
        data: {
          status: 'FAILED',
          error: `Admin kill-switch: ${reason}`,
          completedAt: new Date(),
        },
      });

      logger.info({ userId, killedCount: result.count, reason }, 'User tasks killed');
      return result.count;
    } catch (error) {
      logger.error({ userId, error }, 'Failed to kill user tasks');
      return 0;
    }
  }

  /**
   * Check output size limit
   */
  checkOutputSize(sizeBytes: number): GuardrailCheck {
    if (sizeBytes > AGENT_LIMITS.maxOutputSizeBytes) {
      return {
        allowed: false,
        error: `${ERROR_CODES.OUTPUT_TOO_LARGE}: Output size ${sizeBytes} exceeds limit ${AGENT_LIMITS.maxOutputSizeBytes}`,
        code: ERROR_CODES.OUTPUT_TOO_LARGE,
      };
    }
    return { allowed: true };
  }

  /**
   * Get terminal configuration for safe execution
   */
  getTerminalConfig(): {
    timeout: number;
    maxOutputChars: number;
    allowlist: readonly string[];
    blocklist: readonly string[];
  } {
    return {
      timeout: TERMINAL_GUARDRAILS.timeoutMs,
      maxOutputChars: TERMINAL_GUARDRAILS.maxOutputChars,
      allowlist: TERMINAL_GUARDRAILS.allowlist,
      blocklist: TERMINAL_GUARDRAILS.blocklist,
    };
  }

  /**
   * Get browser configuration for safe execution
   */
  getBrowserConfig(): {
    headless: boolean;
    timeout: number;
    allowedDomains: readonly string[];
    maxWidth: number;
    maxHeight: number;
  } {
    return {
      headless: BROWSER_GUARDRAILS.headless,
      timeout: BROWSER_GUARDRAILS.timeoutMs,
      allowedDomains: BROWSER_GUARDRAILS.allowedDomains,
      maxWidth: BROWSER_GUARDRAILS.maxWidth,
      maxHeight: BROWSER_GUARDRAILS.maxHeight,
    };
  }
}

export const guardrailsService = new GuardrailsService();
