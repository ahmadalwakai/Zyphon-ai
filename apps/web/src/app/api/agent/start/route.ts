/**
 * POST /api/agent/start
 *
 * Accepts { goal: string }, creates a task, launches the agent pipeline,
 * and returns { taskId } immediately.
 */

import { NextRequest, NextResponse } from 'next/server';
import { AgentPipeline, TaskStore } from '@zyphon/agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Pro limit

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { goal?: string };

    if (!body.goal || typeof body.goal !== 'string' || body.goal.trim().length === 0) {
      return NextResponse.json(
        { error: 'Missing or empty "goal" field' },
        { status: 400 }
      );
    }

    if (body.goal.length > 2000) {
      return NextResponse.json(
        { error: 'Goal must be 2000 characters or less' },
        { status: 400 }
      );
    }

    const goal = body.goal.trim();
    const taskId = crypto.randomUUID();

    // Create task in store
    TaskStore.create(taskId, goal);

    // Launch pipeline in background (non-blocking)
    const pipeline = new AgentPipeline(
      process.env['GROK'],
      process.env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile'
    );

    // We don't await — the pipeline runs asynchronously
    // The client polls via /api/agent/status/[taskId] or uses SSE
    pipeline.run({
      taskId,
      goal,
      maxRetries: 3,
      timeoutMs: 55_000,
      groqApiKey: process.env['GROK'],
    }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : 'Unknown pipeline error';
      TaskStore.fail(taskId, msg);
    });

    return NextResponse.json({ taskId, status: 'queued' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
