import { NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

// Helper to get admin user
async function getAdminUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session_token')?.value;
  
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

// GET /api/admin/abuse-monitor - Get abuse monitoring report
export async function GET(request: Request) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get('hours') || '24', 10);

    const since = new Date();
    since.setHours(since.getHours() - hours);

    // Get users with high task counts
    const userTaskCounts = await prisma.userTask.groupBy({
      by: ['workspaceId'],
      where: {
        createdAt: { gte: since },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    });

    // Get workspace-to-user mapping
    type UserData = { id: string; email: string; role: string; suspended: boolean };
    type WorkspaceData = { id: string; user: UserData };
    type TaskCount = { workspaceId: string; _count: { id: number } };
    type RunningTask = { workspace: { user: { id: string; email: string } } };
    type AuditLogRow = { action: string; actor: string; target: string; createdAt: Date; details: unknown };
    
    const workspaceIds = userTaskCounts.map((u: TaskCount) => u.workspaceId);
    const workspaces = await prisma.workspace.findMany({
      where: { id: { in: workspaceIds } },
      include: { user: { select: { id: true, email: true, role: true, suspended: true } } },
    }) as WorkspaceData[];

    const workspaceUserMap = new Map<string, UserData>(workspaces.map((w: WorkspaceData) => [w.id, w.user]));

    // Find users with many failed tasks (potential abuse)
    const failedTasksByUser = await prisma.userTask.groupBy({
      by: ['workspaceId'],
      where: {
        createdAt: { gte: since },
        status: 'FAILED',
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    // Find users with concurrent running tasks
    const runningTasks = await prisma.userTask.findMany({
      where: {
        status: { in: ['PLANNING', 'EXECUTING'] },
      },
      include: {
        workspace: { include: { user: { select: { id: true, email: true } } } },
      },
    });

    const runningByUser = new Map<string, number>();
    for (const task of runningTasks) {
      const userId = task.workspace.user.id;
      runningByUser.set(userId, (runningByUser.get(userId) || 0) + 1);
    }

    // Find rapid-fire task submissions (more than 10 tasks in 5 minutes)
    const fiveMinutesAgo = new Date();
    fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

    const rapidFireUsers = await prisma.userTask.groupBy({
      by: ['workspaceId'],
      where: {
        createdAt: { gte: fiveMinutesAgo },
      },
      _count: { id: true },
      having: {
        id: { _count: { gt: 5 } },
      },
    });

    // Get recent audit logs for task kills
    const recentKills = await prisma.auditLog.findMany({
      where: {
        action: { in: ['TASK_KILLED', 'USER_TASKS_KILLED'] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Build high-activity users report
    const highActivityUsers = userTaskCounts
      .filter((u: TaskCount) => u._count.id >= 10) // Flag users with 10+ tasks in the period
      .map((u: TaskCount) => {
        const user = workspaceUserMap.get(u.workspaceId);
        const failed = failedTasksByUser.find((f: TaskCount) => f.workspaceId === u.workspaceId)?._count.id || 0;
        return {
          userId: user?.id,
          email: user?.email,
          suspended: user?.suspended,
          taskCount: u._count.id,
          failedCount: failed,
          failureRate: Math.round((failed / u._count.id) * 100),
          currentlyRunning: runningByUser.get(user?.id || '') || 0,
        };
      });

    // Build rapid-fire alerts
    const rapidFireAlerts = await Promise.all(
      rapidFireUsers.map(async (r: TaskCount) => {
        const workspace = await prisma.workspace.findUnique({
          where: { id: r.workspaceId },
          include: { user: { select: { id: true, email: true } } },
        });
        return {
          userId: workspace?.user.id,
          email: workspace?.user.email,
          tasksInLast5Min: r._count.id,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: {
        period: {
          hours,
          since: since.toISOString(),
        },
        summary: {
          totalTasksInPeriod: userTaskCounts.reduce((sum: number, u: TaskCount) => sum + u._count.id, 0),
          currentlyRunningTasks: runningTasks.length,
          highActivityUserCount: highActivityUsers.length,
          rapidFireAlertCount: rapidFireAlerts.length,
        },
        highActivityUsers,
        rapidFireAlerts,
        concurrentTasksByUser: Array.from(runningByUser.entries())
          .filter(([_, count]) => count > 1)
          .map(([userId, count]) => {
            const user = (runningTasks as RunningTask[]).find((t: RunningTask) => t.workspace.user.id === userId)?.workspace.user;
            return { userId, email: user?.email, runningCount: count };
          }),
        recentKillActions: (recentKills as AuditLogRow[]).map((k: AuditLogRow) => ({
          action: k.action,
          actor: k.actor,
          target: k.target,
          createdAt: k.createdAt,
          details: k.details,
        })),
      },
    });
  } catch (error) {
    console.error('Abuse monitor error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch abuse data' } },
      { status: 500 }
    );
  }
}
