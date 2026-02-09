import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const dynamic = 'force-dynamic';

let _queue: Queue | null = null;
function getTaskQueue(): Queue {
  if (!_queue) {
    const Redis = (IORedis as any).default || IORedis;
    const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    _queue = new Queue('tasks', { connection });
  }
  return _queue;
}

/**
 * Vercel Cron Job / Manual Trigger for Task Processing
 *
 * Picks up QUEUED user tasks and enqueues them to BullMQ for the worker.
 * Does NOT execute tasks in-process.
 *
 * Configure in vercel.json:
 *   "crons": [{ "path": "/api/cron/process-tasks", "schedule": "every 2 minutes" }]
 */

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (Vercel sends this automatically for cron jobs)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Find queued tasks (limit to 1 per invocation to stay within timeout)
    const queuedTask = await prisma.userTask.findFirst({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      include: { workspace: true },
    });

    if (!queuedTask) {
      return NextResponse.json({
        success: true,
        message: 'No queued tasks',
        processed: 0,
      });
    }

    // Check if there's already a RUNNING task (respect concurrency)
    const runningCount = await prisma.userTask.count({
      where: { status: 'RUNNING' },
    });

    if (runningCount >= 2) {
      return NextResponse.json({
        success: true,
        message: 'Max concurrent tasks reached',
        processed: 0,
        running: runningCount,
      });
    }

    // Process the task
    const userId = queuedTask.workspace.userId;

    // Check credits
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.credits < 1) {
      await prisma.userTask.update({
        where: { id: queuedTask.id },
        data: {
          status: 'FAILED',
          error: 'Insufficient credits',
          completedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Task failed: insufficient credits',
        processed: 1,
      });
    }

    // Update to RUNNING
    await prisma.userTask.update({
      where: { id: queuedTask.id },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        error: null,
        result: null,
      },
    });

    // Deduct base credit
    await prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: 1 } },
    });

    await prisma.creditHistory.create({
      data: {
        userId,
        amount: -1,
        balance: user.credits - 1,
        reason: 'Task execution (cron)',
        taskId: queuedTask.id,
      },
    });

    // Enqueue to BullMQ — worker handles execution
    try {
      const queue = getTaskQueue();
      await queue.add('user-task', {
        taskId: queuedTask.id,
        userId,
        type: 'user',
      }, {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 200,
      });

      return NextResponse.json({
        success: true,
        message: `Task ${queuedTask.id} enqueued`,
        processed: 1,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      await prisma.userTask.update({
        where: { id: queuedTask.id },
        data: {
          status: 'FAILED',
          error: `Failed to enqueue: ${errorMsg}`,
          completedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: false,
        message: `Task ${queuedTask.id} enqueue failed: ${errorMsg}`,
        processed: 1,
      });
    }
  } catch (error) {
    console.error('Cron process-tasks error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
