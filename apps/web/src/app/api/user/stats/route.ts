import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { getAuthUser } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }

    const [totalTasks, completedTasks, runningTasks, totalWorkspaces] = await Promise.all([
      prisma.userTask.count({
        where: { workspace: { userId: user.id, deletedAt: null } },
      }),
      prisma.userTask.count({
        where: { workspace: { userId: user.id, deletedAt: null }, status: 'SUCCEEDED' },
      }),
      prisma.userTask.count({
        where: { workspace: { userId: user.id, deletedAt: null }, status: 'RUNNING' },
      }),
      prisma.userWorkspace.count({
        where: { userId: user.id, deletedAt: null },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        totalTasks,
        completedTasks,
        runningTasks,
        totalWorkspaces,
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
