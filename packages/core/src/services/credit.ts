/**
 * Credit Accounting Service
 * Implements pre-authorization, deduction, and reconciliation.
 */

import { prisma } from '@zyphon/db';
import { CREDIT_COSTS, PLAN_LIMITS, ERROR_CODES, estimateTaskCredits } from '@zyphon/shared';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'credit-service' });

export interface CreditPreAuth {
  userId: string;
  taskId: string;
  estimatedCredits: number;
  authorizedAt: Date;
}

export interface CreditUsage {
  imageGenCount: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  terminalMinutes: number;
  browserMinutes: number;
  stepCount: number;
}

export interface CreditReconciliation {
  preAuthAmount: number;
  actualAmount: number;
  refundAmount: number;
  finalBalance: number;
}

// In-memory pre-auth store (could be Redis for multi-worker)
const preAuthStore = new Map<string, CreditPreAuth>();

export class CreditService {
  /**
   * Pre-authorize credits before task execution.
   * Fails if user doesn't have enough credits.
   */
  async preAuthorize(
    userId: string,
    taskId: string,
    taskType: 'CODING' | 'IMAGE' | 'MIXED',
    maxSteps: number
  ): Promise<{ success: boolean; error?: string; estimatedCredits?: number }> {
    logger.info({ userId, taskId, taskType, maxSteps }, 'Pre-authorizing credits');

    try {
      // Get user with current credits
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, credits: true, plan: true },
      });

      if (!user) {
        return { success: false, error: `User not found: ${userId}` };
      }

      // Calculate estimated credits
      const estimatedCredits = estimateTaskCredits(taskType, maxSteps);

      // Check if user has enough credits
      if (user.credits < estimatedCredits) {
        logger.warn({ userId, credits: user.credits, required: estimatedCredits }, 'Insufficient credits');
        return {
          success: false,
          error: `${ERROR_CODES.INSUFFICIENT_CREDITS}: Need ${estimatedCredits} credits, have ${user.credits}`,
        };
      }

      // Deduct pre-auth amount (hold)
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { credits: { decrement: estimatedCredits } },
        }),
        prisma.creditHistory.create({
          data: {
            userId,
            amount: -estimatedCredits,
            balance: user.credits - estimatedCredits,
            reason: `Pre-auth for task ${taskId}`,
            taskId,
          },
        }),
      ]);

      // Store pre-auth
      preAuthStore.set(taskId, {
        userId,
        taskId,
        estimatedCredits,
        authorizedAt: new Date(),
      });

      logger.info({ userId, taskId, estimatedCredits, newBalance: user.credits - estimatedCredits }, 'Credits pre-authorized');

      return { success: true, estimatedCredits };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ userId, taskId, error: message }, 'Pre-authorization failed');
      return { success: false, error: `${ERROR_CODES.CREDIT_PREAUTH_FAILED}: ${message}` };
    }
  }

  /**
   * Reconcile credits after task completion.
   * Refunds unused credits on failure or if actual cost is less than estimated.
   */
  async reconcile(
    taskId: string,
    actualUsage: CreditUsage,
    taskFailed: boolean
  ): Promise<CreditReconciliation | null> {
    const preAuth = preAuthStore.get(taskId);
    if (!preAuth) {
      logger.warn({ taskId }, 'No pre-auth found for reconciliation');
      return null;
    }

    logger.info({ taskId, actualUsage, taskFailed }, 'Reconciling credits');

    try {
      // Calculate actual credits used
      let actualCredits = CREDIT_COSTS.TASK_BASE;
      actualCredits += actualUsage.imageGenCount * CREDIT_COSTS.IMAGE_GEN;
      actualCredits += Math.ceil(actualUsage.llmInputTokens / 1000) * CREDIT_COSTS.LLM_INPUT_PER_1K;
      actualCredits += Math.ceil(actualUsage.llmOutputTokens / 1000) * CREDIT_COSTS.LLM_OUTPUT_PER_1K;
      actualCredits += Math.ceil(actualUsage.terminalMinutes) * CREDIT_COSTS.TERMINAL_PER_MINUTE;
      actualCredits += Math.ceil(actualUsage.browserMinutes) * CREDIT_COSTS.BROWSER_PER_MINUTE;
      actualCredits += actualUsage.stepCount * CREDIT_COSTS.STEP_BASE;

      // If task failed, refund all except base cost
      if (taskFailed) {
        actualCredits = CREDIT_COSTS.TASK_BASE;
      }

      const refundAmount = Math.max(0, preAuth.estimatedCredits - actualCredits);

      // Get current user
      const user = await prisma.user.findUnique({
        where: { id: preAuth.userId },
        select: { credits: true },
      });

      if (!user) {
        logger.error({ userId: preAuth.userId }, 'User not found during reconciliation');
        return null;
      }

      const finalBalance = user.credits + refundAmount;

      // Refund unused credits
      if (refundAmount > 0) {
        await prisma.$transaction([
          prisma.user.update({
            where: { id: preAuth.userId },
            data: { credits: { increment: refundAmount } },
          }),
          prisma.creditHistory.create({
            data: {
              userId: preAuth.userId,
              amount: refundAmount,
              balance: finalBalance,
              reason: taskFailed
                ? `Refund for failed task ${taskId}`
                : `Reconciliation refund for task ${taskId}`,
              taskId,
            },
          }),
        ]);
      }

      // Update task with credits used
      await prisma.userTask.update({
        where: { id: taskId },
        data: { creditsUsed: actualCredits },
      }).catch(() => {
        // Try organization task table
        return prisma.task.update({
          where: { id: taskId },
          data: { /* no creditsUsed field */ },
        }).catch(() => {});
      });

      // Clean up pre-auth
      preAuthStore.delete(taskId);

      const result: CreditReconciliation = {
        preAuthAmount: preAuth.estimatedCredits,
        actualAmount: actualCredits,
        refundAmount,
        finalBalance,
      };

      logger.info({ taskId, ...result }, 'Credits reconciled');

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ taskId, error: message }, 'Credit reconciliation failed');
      return null;
    }
  }

  /**
   * Get user's credit balance and history
   */
  async getUserCredits(userId: string): Promise<{
    balance: number;
    plan: string;
    monthlyLimit: number;
    history: Array<{ amount: number; balance: number; reason: string; createdAt: Date }>;
  } | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          credits: true,
          plan: true,
          creditHistory: {
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
              amount: true,
              balance: true,
              reason: true,
              createdAt: true,
            },
          },
        },
      });

      if (!user) return null;

      const planConfig = PLAN_LIMITS[user.plan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.FREE;

      return {
        balance: user.credits,
        plan: user.plan,
        monthlyLimit: planConfig.monthlyCredits,
        history: user.creditHistory,
      };
    } catch (error) {
      logger.error({ userId, error }, 'Failed to get user credits');
      return null;
    }
  }

  /**
   * Add credits to a user (for purchases or grants)
   */
  async addCredits(userId: string, amount: number, reason: string): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { credits: true },
      });

      if (!user) return false;

      const newBalance = user.credits + amount;

      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { credits: { increment: amount } },
        }),
        prisma.creditHistory.create({
          data: {
            userId,
            amount,
            balance: newBalance,
            reason,
          },
        }),
      ]);

      logger.info({ userId, amount, newBalance, reason }, 'Credits added');
      return true;
    } catch (error) {
      logger.error({ userId, amount, error }, 'Failed to add credits');
      return false;
    }
  }

  /**
   * Get usage summary for a user (for billing page)
   */
  async getUsageSummary(userId: string, days: number = 30): Promise<{
    totalCreditsUsed: number;
    taskCount: number;
    imageCount: number;
    byDay: Array<{ date: string; credits: number; tasks: number }>;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      // Get credit history
      const history = await prisma.creditHistory.findMany({
        where: {
          userId,
          createdAt: { gte: startDate },
          amount: { lt: 0 }, // Only deductions
        },
        orderBy: { createdAt: 'desc' },
      });

      // Get tasks
      const tasks = await prisma.userTask.findMany({
        where: {
          workspace: { userId },
          createdAt: { gte: startDate },
        },
        select: {
          type: true,
          creditsUsed: true,
          createdAt: true,
        },
      });

      type HistoryRow = { amount: number };
      type TaskRow = { type: string; creditsUsed: number; createdAt: Date };
      
      const totalCreditsUsed = Math.abs(history.reduce((sum: number, h: HistoryRow) => sum + h.amount, 0));
      const taskCount = tasks.length;
      const imageCount = (tasks as TaskRow[]).filter((t: TaskRow) => t.type === 'IMAGE').length;

      // Group by day
      const byDayMap = new Map<string, { credits: number; tasks: number }>();
      for (const task of tasks) {
        const date = task.createdAt.toISOString().split('T')[0];
        const existing = byDayMap.get(date) || { credits: 0, tasks: 0 };
        existing.credits += task.creditsUsed;
        existing.tasks += 1;
        byDayMap.set(date, existing);
      }

      const byDay = Array.from(byDayMap.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return { totalCreditsUsed, taskCount, imageCount, byDay };
    } catch (error) {
      logger.error({ userId, error }, 'Failed to get usage summary');
      return { totalCreditsUsed: 0, taskCount: 0, imageCount: 0, byDay: [] };
    }
  }
}

export const creditService = new CreditService();
