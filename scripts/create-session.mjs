import { createRequire } from 'module';
import crypto from 'crypto';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client');
const prisma = new PrismaClient();

const userId = 'c7e7ebe8-0eeb-4695-8e1a-a3eae1e66ba5';

// Create a session token
const token = crypto.randomUUID();
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

const session = await prisma.session.create({
  data: {
    userId,
    token,
    expiresAt,
  },
});

console.log('Session token:', token);
console.log('Session id:', session.id);

await prisma.$disconnect();
