import { NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

// Helper to get authenticated user
async function getAuthUser() {
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
  
  return session?.user || null;
}

// GET /api/user/credits/usage - Get detailed usage summary
export async function GET(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get credit history
    const history = await prisma.creditHistory.findMany({
      where: {
        userId: user.id,
        createdAt: { gte: startDate },
        amount: { lt: 0 }, // Only deductions
      },
      orderBy: { createdAt: 'desc' },
      select: {
        amount: true,
        reason: true,
        taskId: true,
        createdAt: true,
      },
    });

    // Get tasks for the period
    const tasks = await prisma.userTask.findMany({
      where: {
        workspace: { userId: user.id },
        createdAt: { gte: startDate },
      },
      select: {
        id: true,
        type: true,
        status: true,
        creditsUsed: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate totals
    const totalCreditsUsed = Math.abs(history.reduce((sum: number, h: { amount: number }) => sum + h.amount, 0));
    const taskCount = tasks.length;
    type TaskRow = { id: string; type: string; status: string; creditsUsed: number; createdAt: Date };
    const imageCount = tasks.filter((t: TaskRow) => t.type === 'IMAGE').length;
    const codeCount = tasks.filter((t: TaskRow) => t.type === 'CODING').length;
    const mixedCount = tasks.filter((t: TaskRow) => t.type === 'MIXED').length;
    const successCount = tasks.filter((t: TaskRow) => t.status === 'SUCCEEDED').length;
    const failedCount = tasks.filter((t: TaskRow) => t.status === 'FAILED').length;

    // Group by day
    const byDayMap = new Map<string, { credits: number; tasks: number; images: number }>();
    
    for (const task of tasks) {
      const date = task.createdAt.toISOString().split('T')[0];
      const existing = byDayMap.get(date) || { credits: 0, tasks: 0, images: 0 };
      existing.credits += task.creditsUsed;
      existing.tasks += 1;
      if (task.type === 'IMAGE') existing.images += 1;
      byDayMap.set(date, existing);
    }

    const byDay = Array.from(byDayMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate average credits per task
    const avgCreditsPerTask = taskCount > 0 ? Math.round(totalCreditsUsed / taskCount) : 0;

    return NextResponse.json({
      success: true,
      data: {
        period: {
          start: startDate.toISOString(),
          end: new Date().toISOString(),
          days,
        },
        summary: {
          totalCreditsUsed,
          taskCount,
          imageCount,
          codeCount,
          mixedCount,
          successCount,
          failedCount,
          avgCreditsPerTask,
          successRate: taskCount > 0 ? Math.round((successCount / taskCount) * 100) : 0,
        },
        byDay,
        recentHistory: history.slice(0, 20).map((h: { amount: number; reason: string; taskId: string | null; createdAt: Date }) => ({
          amount: h.amount,
          reason: h.reason,
          taskId: h.taskId,
          createdAt: h.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error('Usage API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch usage' } },
      { status: 500 }
    );
  }
}
