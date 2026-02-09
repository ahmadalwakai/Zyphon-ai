import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { success: false, error: { message: 'Email is required' } },
        { status: 400 }
      );
    }

    // Find user - but don't reveal if they exist or not
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (user && !user.deletedAt) {
      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Store reset token (in production, you'd hash this)
      await prisma.user.update({
        where: { id: user.id },
        data: {
          // Note: You'd need to add these fields to your Prisma schema
          // resetToken: resetToken,
          // resetTokenExpiry: resetTokenExpiry,
        },
      });

      // In production, send email here
      // await sendPasswordResetEmail(user.email, resetToken);
      
      console.log(`[Password Reset] Token generated for ${email}: ${resetToken}`);
    }

    // Always return success to prevent email enumeration
    return NextResponse.json({
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link.',
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'An error occurred' } },
      { status: 500 }
    );
  }
}
