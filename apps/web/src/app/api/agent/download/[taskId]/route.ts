/**
 * GET /api/agent/download/[taskId]
 *
 * Downloads the packaged zip file for a completed task.
 */

import { NextRequest, NextResponse } from 'next/server';
import { TaskStore } from '@zyphon/agent';
import { Packager } from '@zyphon/executor';
import * as fs from 'node:fs';

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

  if (!task.zipPath) {
    return NextResponse.json(
      { error: 'No download available for this task' },
      { status: 404 }
    );
  }

  // Check if zip file still exists
  if (!fs.existsSync(task.zipPath)) {
    return NextResponse.json(
      { error: 'Download file has expired — please re-run the task' },
      { status: 410 }
    );
  }

  const buffer = Packager.readAsBuffer(task.zipPath);
  const uint8 = new Uint8Array(buffer);

  // Derive filename from goal
  const filename = task.goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30) || 'project';

  return new Response(uint8, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}.zip"`,
      'Content-Length': buffer.length.toString(),
    },
  });
}
