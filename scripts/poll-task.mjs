import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client');
const prisma = new PrismaClient();

const taskId = process.argv[2];
if (!taskId) { console.error('Usage: node poll-task.mjs <taskId>'); process.exit(1); }

const start = Date.now();
const MAX_WAIT = 600_000; // 10 min

while (Date.now() - start < MAX_WAIT) {
  const t = await prisma.userTask.findUnique({ where: { id: taskId }, select: { status: true, error: true } });
  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log(`${elapsed}s: ${t.status}${t.error ? ' — ' + t.error.substring(0, 100) : ''}`);
  if (t.status === 'SUCCEEDED' || t.status === 'FAILED') break;
  await new Promise(r => setTimeout(r, 10_000));
}

await prisma.$disconnect();
