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

// POST /api/admin/users/[id]/kill-tasks - Kill all running tasks for a user
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

    const { id: userId } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || 'Admin user kill-switch activated';

    // Find the user
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!targetUser) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } },
        { status: 404 }
      );
    }

    // Find all running tasks for this user
    const runningTasks = await prisma.userTask.findMany({
      where: {
        workspace: { userId },
        status: { in: ['PLANNING', 'EXECUTING'] },
      },
      select: { id: true, status: true },
    });

    if (runningTasks.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          userId,
          killedCount: 0,
          message: 'No running tasks to kill',
        },
      });
    }

    // Kill all running tasks
    const taskIds = runningTasks.map((t: { id: string; status: string }) => t.id);
    await prisma.userTask.updateMany({
      where: {
        id: { in: taskIds },
      },
      data: {
        status: 'FAILED',
      },
    });

    // Update each task's result with kill info (must be done individually)
    for (const task of runningTasks) {
      const existingTask = await prisma.userTask.findUnique({
        where: { id: task.id },
        select: { result: true },
      });
      
      await prisma.userTask.update({
        where: { id: task.id },
        data: {
          result: {
            ...(typeof existingTask?.result === 'object' && existingTask.result !== null ? existingTask.result : {}),
            killedBy: admin.id,
            killReason: reason,
            killedAt: new Date().toISOString(),
            batchKill: true,
          },
        },
      });
    }

    // Log the admin action
    await prisma.auditLog.create({
      data: {
        action: 'USER_TASKS_KILLED',
        actor: admin.email,
        actorId: admin.id,
        target: `user:${userId}`,
        details: {
          userId,
          userEmail: targetUser.email,
          reason,
          taskIds,
          count: taskIds.length,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        userId,
        killedCount: taskIds.length,
        taskIds,
        reason,
      },
    });
  } catch (error) {
    console.error('Kill user tasks error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to kill user tasks' } },
      { status: 500 }
    );
  }
}
