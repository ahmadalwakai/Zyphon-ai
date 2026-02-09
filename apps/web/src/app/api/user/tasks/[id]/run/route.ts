import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { getAuthUser } from '../../../../../../lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow up to 5 minutes for task execution (Vercel Pro)

// Import orchestrator for direct execution (or queue via Redis)
// Uses dynamic import to reduce cold start time

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

    // Start execution in background
    // In production, this should be queued via Redis/BullMQ
    runTaskInBackground(taskId, user.id).catch(console.error);

    return NextResponse.json({
      success: true,
      data: { taskId, status: 'RUNNING' },
    });
  } catch (error) {
    console.error('Run task error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

async function runTaskInBackground(taskId: string, userId: string) {
  try {
    // Validate critical env vars before attempting execution
    if (!process.env.DATABASE_URL) {
      throw new Error('ENV_MISSING: DATABASE_URL is not configured. Set it in Vercel Environment Variables.');
    }
    
    const ollamaUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL;
    if (!ollamaUrl) {
      console.warn('[Task Runner] OLLAMA_BASE_URL not set, using default localhost:11434');
    }

    // Dynamic import to avoid server-side cold start overhead
    const { UserTaskOrchestrator } = await import('../../../../../../lib/user-orchestrator');
    const orchestrator = new UserTaskOrchestrator();
    await orchestrator.runTask(taskId, userId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Task Runner] Task ${taskId} failed:`, errorMsg);
    
    // Provide user-friendly error messages
    let userError = errorMsg;
    if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNREFUSED')) {
      userError = 'Service connection failed. The AI service (Ollama) may be unavailable. Please try again later or contact support.';
    } else if (errorMsg.includes('ENV_MISSING')) {
      userError = 'Platform configuration error. Please contact support.';
    } else if (errorMsg.includes('timeout') || errorMsg.includes('TIMEOUT')) {
      userError = 'Task timed out. The AI service took too long to respond. Please try again with a simpler request.';
    }

    // Update task with error
    await prisma.userTask.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        error: userError,
        completedAt: new Date(),
      },
    });
  }
}
