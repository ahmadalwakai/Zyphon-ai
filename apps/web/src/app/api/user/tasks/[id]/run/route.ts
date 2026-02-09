import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { getAuthUser } from '../../../../../../lib/auth';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const dynamic = 'force-dynamic';

// ── BullMQ queue (lazy singleton) ──────────────────────────────────────
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }

    const { id: taskId } = await params;
    const body = await request.json().catch(() => ({}));
    const force = body?.force || false;

    // Get and verify task
    const task = await prisma.userTask.findFirst({
      where: {
        id: taskId,
        workspace: { userId: user.id, deletedAt: null },
      },
      include: { workspace: true },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: { message: 'Task not found' } },
        { status: 404 }
      );
    }

    if (task.status !== 'QUEUED' && !force) {
      return NextResponse.json(
        { success: false, error: { message: `Task is not in QUEUED state (current: ${task.status})` } },
        { status: 400 }
      );
    }

    // Check credits
    const currentUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!currentUser || currentUser.credits < 1) {
      return NextResponse.json(
        { success: false, error: { message: 'Insufficient credits' } },
        { status: 402 }
      );
    }

    // Reset task if force retry
    if (force) {
      await prisma.userTaskStep.deleteMany({ where: { taskId } });
      await prisma.userArtifact.deleteMany({ where: { taskId } });
    }

    // Update task status to RUNNING
    await prisma.userTask.update({
      where: { id: taskId },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        error: null,
        result: null,
      },
    });

    // Deduct credit
    await prisma.user.update({
      where: { id: user.id },
      data: { credits: { decrement: 1 } },
    });

    await prisma.creditHistory.create({
      data: {
        userId: user.id,
        amount: -1,
        balance: currentUser.credits - 1,
        reason: 'Task execution',
        taskId,
      },
    });

    // ── Enqueue to BullMQ (worker picks this up) ──
    const queue = getTaskQueue();
    const job = await queue.add('user-task', {
      taskId,
      userId: user.id,
      type: 'user',
    }, {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 200,
    });

    console.log(`[WEB:run] Enqueued taskId=${taskId} userId=${user.id} → jobId=${job.id}`);

    return NextResponse.json({
      success: true,
      data: { taskId, status: 'RUNNING', jobId: job.id },
    });
  } catch (error) {
    console.error('Run task error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
