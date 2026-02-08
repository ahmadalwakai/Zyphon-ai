import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { getAuthUser } from '@/lib/auth';

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

    const workspace = await prisma.userWorkspace.findFirst({
      where: { id, userId: user.id, deletedAt: null },
      include: {
        tasks: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, error: { message: 'Workspace not found' } },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: workspace });
  } catch (error) {
    console.error('Get workspace error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const workspace = await prisma.userWorkspace.findFirst({
      where: { id, userId: user.id, deletedAt: null },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, error: { message: 'Workspace not found' } },
        { status: 404 }
      );
    }

    await prisma.userWorkspace.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete workspace error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
