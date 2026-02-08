import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { getAuthUser } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }

    const { name } = await request.json();

    await prisma.user.update({
      where: { id: user.id },
      data: { name: name || null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
