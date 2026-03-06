/**
 * GET /api/agent/status/[taskId]
 *
 * Returns current task state: status, currentStep, logs, downloadUrl.
 */

import { NextRequest, NextResponse } from 'next/server';
import { TaskStore } from '@zyphon/agent';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const { taskId } = params;

  if (!taskId) {
    return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
  }

  const task = TaskStore.get(taskId);

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  return NextResponse.json({
    taskId: task.taskId,
    goal: task.goal,
    status: task.status,
    currentStep: task.currentStep,
    totalSteps: task.totalSteps,
    logs: task.logs,
    error: task.error,
    downloadUrl: task.downloadUrl,
    fileCount: task.fileCount,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    durationMs: task.completedAt ? task.completedAt - task.createdAt : Date.now() - task.createdAt,
  });
}
