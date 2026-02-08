import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');

    const workspaces = await prisma.userWorkspace.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        _count: { select: { tasks: true } },
      },
    });

    return NextResponse.json({ success: true, data: workspaces });
  } catch (error) {
    console.error('Get workspaces error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }

    const { name, description } = await request.json();

    if (!name || name.length > 100) {
      return NextResponse.json(
        { success: false, error: { message: 'Name is required (max 100 chars)' } },
        { status: 400 }
      );
    }

    const workspace = await prisma.userWorkspace.create({
      data: {
        userId: user.id,
        name,
        description: description || null,
      },
    });

    return NextResponse.json({ success: true, data: workspace }, { status: 201 });
  } catch (error) {
    console.error('Create workspace error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
