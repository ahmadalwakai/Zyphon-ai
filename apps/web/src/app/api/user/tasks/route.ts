import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { getAuthUser } from '@/lib/auth';
import path from 'path';

export const dynamic = 'force-dynamic';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './workspaces';

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
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);
    const search = url.searchParams.get('search') || '';
    const status = url.searchParams.get('status') || '';

    const where: any = {
      workspace: { userId: user.id, deletedAt: null },
    };

    if (search) {
      where.goal = { contains: search, mode: 'insensitive' };
    }
    if (status) {
      where.status = status;
    }

    const [tasks, total] = await Promise.all([
      prisma.userTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          workspace: { select: { name: true } },
        },
      }),
      prisma.userTask.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: tasks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get tasks error:', error);
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

    const { workspaceId, goal, context, type = 'CODING' } = await request.json();

    if (!workspaceId || !goal) {
      return NextResponse.json(
        { success: false, error: { message: 'workspaceId and goal are required' } },
        { status: 400 }
      );
    }

    // Verify workspace ownership
    const workspace = await prisma.userWorkspace.findFirst({
      where: { id: workspaceId, userId: user.id, deletedAt: null },
    });

    if (!workspace) {
      return NextResponse.json(
        { success: false, error: { message: 'Workspace not found' } },
        { status: 404 }
      );
    }

    // Check credits
    if (user.credits < 1) {
      return NextResponse.json(
        { success: false, error: { message: 'Insufficient credits' } },
        { status: 402 }
      );
    }

    // Create task
    const taskId = crypto.randomUUID();
    // Use consistent workspace path: workspaces/{taskId}
    const workspacePath = path.join(WORKSPACE_ROOT, taskId);

    const task = await prisma.userTask.create({
      data: {
        id: taskId,
        workspaceId,
        goal,
        context: context || null,
        type,
        status: 'QUEUED',
        workspacePath,
      },
    });

    return NextResponse.json({ success: true, data: task }, { status: 201 });
  } catch (error) {
    console.error('Create task error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
