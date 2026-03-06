import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { getAuthUser } from '../../../../../../lib/auth';
import { AgentPipeline, TaskStore } from '@zyphon/agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

    const goal = task.goal;
    if (!goal) {
      return NextResponse.json(
        { success: false, error: { message: 'Task has no goal defined' } },
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

    // ── Launch agent pipeline (same as /api/agent/start) ──
    TaskStore.create(taskId, goal);

    const pipeline = new AgentPipeline(
      process.env['GROK'],
      process.env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile'
    );

    // Fire-and-forget: pipeline runs in background, client uses SSE to follow
    pipeline.run({
      taskId,
      goal,
      maxRetries: 3,
      timeoutMs: 55_000,
      groqApiKey: process.env['GROK'],
    }).then(async (result) => {
      // Sync final state back to DB
      await prisma.userTask.update({
        where: { id: taskId },
        data: {
          status: result.success ? 'COMPLETED' : 'FAILED',
          completedAt: new Date(),
          result: result.success ? { fileCount: result.fileCount, downloadUrl: result.downloadUrl } : undefined,
          error: result.error ?? null,
        },
      }).catch((e: unknown) => console.error('[run] DB sync error:', e));
    }).catch(async (error: unknown) => {
      const msg = error instanceof Error ? error.message : 'Unknown pipeline error';
      TaskStore.fail(taskId, msg);
      await prisma.userTask.update({
        where: { id: taskId },
        data: { status: 'FAILED', completedAt: new Date(), error: msg },
      }).catch((e: unknown) => console.error('[run] DB sync error:', e));
    });

    console.log(`[WEB:run] Launched pipeline taskId=${taskId} userId=${user.id} goal="${goal.slice(0, 60)}"`);

    // ── Stream SSE events back to the client ──
    const encoder = new TextEncoder();
    let lastLogIndex = 0;
    let closed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          } catch {
            closed = true;
          }
        };

        // Send initial state
        sendEvent('status', { status: 'queued', currentStep: 0, totalSteps: 0 });

        // Poll for updates every 500ms
        const interval = setInterval(() => {
          const current = TaskStore.get(taskId);
          if (!current || closed) {
            clearInterval(interval);
            if (!closed) {
              closed = true;
              controller.close();
            }
            return;
          }

          // Send new log entries
          if (current.logs.length > lastLogIndex) {
            const newLogs = current.logs.slice(lastLogIndex);
            lastLogIndex = current.logs.length;
            for (const log of newLogs) {
              sendEvent('log', log);
            }
          }

          // Send status updates
          sendEvent('status', {
            status: current.status,
            currentStep: current.currentStep,
            totalSteps: current.totalSteps,
          });

          // Close on completion or failure
          if (current.status === 'complete' || current.status === 'failed') {
            sendEvent('done', {
              status: current.status,
              downloadUrl: current.downloadUrl,
              fileCount: current.fileCount,
              error: current.error,
              durationMs: current.completedAt
                ? current.completedAt - current.createdAt
                : Date.now() - current.createdAt,
            });
            clearInterval(interval);
            if (!closed) {
              closed = true;
              controller.close();
            }
          }
        }, 500);

        // Safety timeout: close after 65 seconds
        setTimeout(() => {
          clearInterval(interval);
          if (!closed) {
            sendEvent('timeout', { message: 'Stream timed out' });
            closed = true;
            controller.close();
          }
        }, 65_000);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Run task error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
