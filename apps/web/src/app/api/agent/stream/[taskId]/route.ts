/**
 * GET /api/agent/stream/[taskId]
 *
 * Server-Sent Events (SSE) endpoint for real-time task updates.
 * Streams logs as they happen until the task completes or fails.
 */

import { NextRequest } from 'next/server';
import { TaskStore } from '@zyphon/agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const { taskId } = params;

  if (!taskId) {
    return new Response('Missing taskId', { status: 400 });
  }

  const task = TaskStore.get(taskId);
  if (!task) {
    return new Response('Task not found', { status: 404 });
  }

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
      sendEvent('status', {
        status: task.status,
        currentStep: task.currentStep,
        totalSteps: task.totalSteps,
      });

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
}
