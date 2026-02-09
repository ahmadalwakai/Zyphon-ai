import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client');
const prisma = new PrismaClient();

const userId = 'c7e7ebe8-0eeb-4695-8e1a-a3eae1e66ba5';
const workspaceId = 'abe7f1b5-889a-4210-9a9d-41a2eee3648a';

// Create LLM-only task
const llmTask = await prisma.userTask.create({
  data: {
    workspaceId,
    goal: 'Write a short haiku about programming in JavaScript',
    type: 'CODING',
    status: 'QUEUED',
    workspacePath: '',
  },
});
console.log('LLM task created:', llmTask.id);

// Create IMAGE task
const imgTask = await prisma.userTask.create({
  data: {
    workspaceId,
    goal: 'Generate a simple test image of a sunset over mountains',
    type: 'IMAGE',
    status: 'QUEUED',
    workspacePath: '',
  },
});
console.log('IMAGE task created:', imgTask.id);

await prisma.$disconnect();
