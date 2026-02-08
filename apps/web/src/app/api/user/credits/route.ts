import { NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

// Helper to get authenticated user
async function getAuthUser() {
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
  
  return session?.user || null;
}

// GET /api/user/credits - Get user credit balance and summary
export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      );
    }

    // Calculate monthly usage
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyHistory = await prisma.creditHistory.findMany({
      where: {
        userId: user.id,
        createdAt: { gte: startOfMonth },
        amount: { lt: 0 }, // Only deductions
      },
      select: { amount: true },
    });

    const monthlyUsed = Math.abs(monthlyHistory.reduce((sum: number, h: { amount: number }) => sum + h.amount, 0));

    // Get plan limits
    const planLimits = {
      FREE: { monthly: 100, description: 'Free Plan' },
      PRO: { monthly: 2000, description: 'Pro Plan' },
      UNLIMITED: { monthly: 999999, description: 'Unlimited Plan' },
    };

    const planInfo = planLimits[user.plan as keyof typeof planLimits] || planLimits.FREE;

    return NextResponse.json({
      success: true,
      data: {
        balance: user.credits,
        plan: user.plan,
        planDescription: planInfo.description,
        monthlyLimit: planInfo.monthly,
        monthlyUsed,
        monthlyRemaining: Math.max(0, planInfo.monthly - monthlyUsed),
      },
    });
  } catch (error) {
    console.error('Credits API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to fetch credits' } },
      { status: 500 }
    );
  }
}
