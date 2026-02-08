import { cookies } from 'next/headers';
import { prisma } from '@zyphon/db';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  credits: number;
}

export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session')?.value;

    if (!token) {
      return null;
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date() || session.user.deletedAt) {
      return null;
    }

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      plan: session.user.plan,
      credits: session.user.credits,
    };
  } catch {
    return null;
  }
}
