import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client');

const prisma = new PrismaClient();

const users = await prisma.user.findMany({ select: { id: true, email: true, credits: true } });
console.log('Users:', JSON.stringify(users, null, 2));

const workspaces = await prisma.userWorkspace.findMany({ select: { id: true, userId: true, name: true, deletedAt: true } });
console.log('Workspaces:', JSON.stringify(workspaces, null, 2));

await prisma.$disconnect();
