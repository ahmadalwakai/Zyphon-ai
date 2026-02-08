import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { 
  orchestrator, 
  BrowserTool, 
  startupService,
  creditService,
  guardrailsService,
} from '@zyphon/core';
import { prisma } from '@zyphon/db';
import { CREDIT_COSTS } from '@zyphon/shared';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({
  name: 'zyphon-worker',
  level: process.env['LOG_LEVEL'] || 'info',
});

const Redis = (IORedis as any).default || IORedis;
const redis = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

interface TaskJobData {
  taskId: string;
  userId?: string;
}

// Track usage per task
const taskUsage = new Map<string, {
  imageGenCount: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  terminalMinutes: number;
  browserMinutes: number;
  stepCount: number;
  startTime: number;
}>();

async function processTask(job: Job<TaskJobData>): Promise<void> {
  const { taskId } = job.data;
  const startTime = Date.now();

  logger.info({ taskId, jobId: job.id }, 'Processing task');

  // Initialize usage tracking
  taskUsage.set(taskId, {
    imageGenCount: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    terminalMinutes: 0,
    browserMinutes: 0,
    stepCount: 0,
    startTime,
  });

  let taskFailed = false;

  try {
    // Get task details
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { project: true },
    });

    if (!task) {
      // Try user task
      const userTask = await prisma.userTask.findUnique({
        where: { id: taskId },
        include: { workspace: true },
      });

      if (!userTask) {
        throw new Error(`Task not found: ${taskId}`);
      }

      // User task flow
      const userId = userTask.workspace.userId;

      // Check guardrails
      const concurrentCheck = await guardrailsService.checkConcurrentTasks(userId);
      if (!concurrentCheck.allowed) {
        throw new Error(concurrentCheck.error);
      }

      // Pre-authorize credits
      const preAuth = await creditService.preAuthorize(
        userId,
        taskId,
        userTask.type as 'CODING' | 'IMAGE' | 'MIXED',
        16 // maxSteps
      );

      if (!preAuth.success) {
        throw new Error(preAuth.error);
      }

      // Record usage event
      await prisma.usageEvent.create({
        data: {
          orgId: 'user_tasks', // Placeholder for user tasks
          taskId,
          event: 'task.started',
          tokens: 0,
          cost: 0,
          metadata: { userId, preAuth: preAuth.estimatedCredits },
        },
      }).catch(() => {}); // Ignore if table doesn't exist

      // Run the orchestrator
      await orchestrator.runTask(taskId);

      // Record completion
      const usage = taskUsage.get(taskId);
      await prisma.usageEvent.create({
        data: {
          orgId: 'user_tasks',
          taskId,
          event: 'task.completed',
          tokens: (usage?.llmInputTokens || 0) + (usage?.llmOutputTokens || 0),
          cost: 0,
          metadata: usage,
        },
      }).catch(() => {});

      // Reconcile credits
      if (usage) {
        await creditService.reconcile(taskId, usage, false);
      }

      logger.info({ taskId, jobId: job.id }, 'Task completed successfully');
      return;
    }

    // Organization task flow
    await prisma.usageEvent.create({
      data: {
        orgId: task.project.orgId,
        taskId,
        event: 'task.started',
        tokens: 0,
        cost: 0,
      },
    });

    // Run the orchestrator
    await orchestrator.runTask(taskId);

    // Record completion
    const usage = taskUsage.get(taskId);
    await prisma.usageEvent.create({
      data: {
        orgId: task.project.orgId,
        taskId,
        event: 'task.completed',
        tokens: (usage?.llmInputTokens || 0) + (usage?.llmOutputTokens || 0),
        cost: 0,
        metadata: usage,
      },
    });

    logger.info({ taskId, jobId: job.id }, 'Task completed successfully');
  } catch (error) {
    taskFailed = true;
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ taskId, jobId: job.id, error: message }, 'Task failed');

    // Reconcile credits on failure
    const usage = taskUsage.get(taskId);
    if (usage) {
      // Get user ID from task
      const userTask = await prisma.userTask.findUnique({
        where: { id: taskId },
        include: { workspace: { select: { userId: true } } },
      }).catch(() => null);

      if (userTask) {
        await creditService.reconcile(taskId, usage, true);
      }
    }

    throw error;
  } finally {
    // Clean up usage tracking
    taskUsage.delete(taskId);
  }
}

async function main() {
  logger.info('Starting Zyphon Worker...');

  // Run startup checks
  const startupReport = await startupService.runAllChecks();

  if (!startupReport.passed) {
    logger.error({ criticalFailures: startupReport.criticalFailures }, 'Startup checks failed');
    console.error('\n❌ STARTUP FAILED: Critical checks did not pass\n');
    process.exit(1);
  }

  // Log warnings but continue
  if (startupReport.warnings.length > 0) {
    logger.warn({ warnings: startupReport.warnings }, 'Startup warnings');
  }

  const worker = new Worker('tasks', processTask, {
    connection: redis,
    concurrency: parseInt(process.env['WORKER_CONCURRENCY'] || '1', 10),
    limiter: {
      max: 10,
      duration: 60000, // 10 jobs per minute max
    },
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, taskId: job.data.taskId }, 'Job completed');
  });

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, taskId: job?.data.taskId, error: error.message }, 'Job failed');
  });

  worker.on('error', (error) => {
    logger.error({ error: error.message }, 'Worker error');
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down worker...');
    await worker.close();
    await BrowserTool.closeBrowser();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info(`
╔═══════════════════════════════════════════════════════════════╗
║                    ZYPHON WORKER                              ║
╠═══════════════════════════════════════════════════════════════╣
║  Queue:       tasks                                           ║
║  Concurrency: ${(process.env['WORKER_CONCURRENCY'] || '1').padEnd(46)}║
║  Redis:       ${(process.env['REDIS_URL'] || 'redis://localhost:6379').substring(0, 44).padEnd(46)}║
║  Status:      READY                                           ║
╚═══════════════════════════════════════════════════════════════╝
  `);
}

main().catch((error) => {
  logger.error({ error: error.message }, 'Worker startup failed');
  process.exit(1);
});

