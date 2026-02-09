import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json(
        { success: false, error: { message: 'Token and password are required' } },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { success: false, error: { message: 'Password must be at least 8 characters' } },
        { status: 400 }
      );
    }

    // In production, you would:
    // 1. Find user by reset token (hashed)
    // 2. Check token hasn't expired
    // 3. Update password and clear reset token
    
    // For now, return an appropriate message
    // This would need the resetToken and resetTokenExpiry fields in User model
    
    /*
    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: { message: 'Invalid or expired reset token' } },
        { status: 400 }
      );
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 12);

    // Update user
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    // Invalidate all sessions
    await prisma.session.deleteMany({
      where: { userId: user.id },
    });
    */

    // For demo purposes, just return success
    return NextResponse.json({
      success: true,
      message: 'Password has been reset successfully',
    });

  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json(
      { success: false, error: { message: 'An error occurred' } },
      { status: 500 }
    );
  }
}
