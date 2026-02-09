import { NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

// Helper to get admin user
async function getAdminUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session')?.value || cookieStore.get('session_token')?.value;
  
  if (!sessionToken) return null;
  
  const session = await prisma.session.findFirst({
    where: {
      token: sessionToken,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });
  
  const user = session?.user;
  if (!user || user.role !== 'ADMIN') return null;
  
  return user;
}

// POST /api/admin/tasks/[id]/kill - Kill a running task
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
        { status: 403 }
      );
    }

    const { id: taskId } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || 'Admin kill-switch activated';

    // Find the task
    const task = await prisma.userTask.findUnique({
      where: { id: taskId },
      include: { workspace: { include: { user: true } } },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Task not found' } },
        { status: 404 }
      );
    }

    if (task.status !== 'PLANNING' && task.status !== 'EXECUTING') {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_STATE', message: 'Task is not running' } },
        { status: 400 }
      );
    }

    // Update task status
    const updatedTask = await prisma.userTask.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        result: {
          ...(typeof task.result === 'object' && task.result !== null ? task.result : {}),
          killedBy: admin.id,
          killReason: reason,
          killedAt: new Date().toISOString(),
        },
      },
    });

    // Log the admin action
    await prisma.auditLog.create({
      data: {
        action: 'TASK_KILLED',
        actor: admin.email,
        actorId: admin.id,
        target: `task:${taskId}`,
        details: {
          taskId,
          userId: task.workspace.user.id,
          userEmail: task.workspace.user.email,
          reason,
          previousStatus: task.status,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        taskId,
        status: 'FAILED',
        killedBy: admin.id,
        reason,
      },
    });
  } catch (error) {
    console.error('Kill task error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to kill task' } },
      { status: 500 }
    );
  }
}
