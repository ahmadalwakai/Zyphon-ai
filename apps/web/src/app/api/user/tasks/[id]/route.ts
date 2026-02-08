import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { getAuthUser } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
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

    const { id } = await params;

    const task = await prisma.userTask.findFirst({
      where: {
        id,
        workspace: { userId: user.id, deletedAt: null },
      },
      include: {
        workspace: { select: { name: true } },
        steps: { orderBy: { index: 'asc' } },
        artifacts: true,
      },
    });

    if (!task) {
      return NextResponse.json(
        { success: false, error: { message: 'Task not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: task });
  } catch (error) {
    console.error('Get task error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
