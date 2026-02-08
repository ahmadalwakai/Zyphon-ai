import { FastifyPluginAsync } from 'fastify';
import { prisma } from '@zyphon/db';
import { CreateTaskSchema, RunTaskSchema } from '@zyphon/shared';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

let taskQueue: Queue | null = null;

function getTaskQueue(): Queue | null {
  if (!taskQueue) {
    try {
      const Redis = (IORedis as any).default || IORedis;
      const redis = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
      taskQueue = new Queue('tasks', { connection: redis });
    } catch {
      console.warn('Redis not available, task queue disabled');
    }
  }
  return taskQueue;
}

export const publicRoutes: FastifyPluginAsync = async (fastify) => {
  // All routes require API key
  fastify.addHook('preHandler', async (request) => {
    await (fastify as any).requireApiKey(request);
  });

  // POST /v1/tasks - Create a new task
  fastify.post('/tasks', {
    schema: {
      description: 'Create a new task',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['projectId', 'goal'],
        properties: {
          projectId: { type: 'string', format: 'uuid' },
          goal: { type: 'string', minLength: 1, maxLength: 2000 },
          context: { type: 'string', maxLength: 10000 },
          type: { type: 'string', enum: ['CODING', 'IMAGE', 'MIXED'] },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                status: { type: 'string' },
                createdAt: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const input = CreateTaskSchema.parse(request.body);

    // Verify project belongs to org
    const project = await (prisma as any).project.findFirst({
      where: {
        id: input.projectId,
        orgId: request.apiKey!.orgId,
        deletedAt: null,
      },
    });

    if (!project) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Project not found' },
      });
    }

    // Create task
    const task = await (prisma as any).task.create({
      data: {
        projectId: input.projectId,
        goal: input.goal,
        context: input.context,
        type: input.type,
        status: 'QUEUED',
        workspacePath: '',
      },
    });

    await request.audit('task.created', 'task', task.id, {
      projectId: input.projectId,
      goal: input.goal.substring(0, 100),
    });

    return reply.status(201).send({
      success: true,
      data: {
        id: task.id,
        status: task.status,
        createdAt: task.createdAt.toISOString(),
      },
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // POST /v1/tasks/:id/run - Start task execution
  fastify.post('/tasks/:id/run', {
    schema: {
      description: 'Start task execution',
      security: [{ apiKey: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          force: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { force } = RunTaskSchema.parse(request.body || {});

    // Get task with project for org verification
    const task = await (prisma as any).task.findFirst({
      where: { id },
      include: { project: true },
    });

    if (!task || task.project.orgId !== request.apiKey!.orgId) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Task not found' },
      });
    }

    if (task.status !== 'QUEUED' && !force) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: `Task is in ${task.status} state. Use force=true to retry.`,
        },
      });
    }

    // Reset task if forcing
    if (force && task.status !== 'QUEUED') {
      await (prisma as any).task.update({
        where: { id },
        data: {
          status: 'QUEUED',
          startedAt: null,
          completedAt: null,
          error: null,
          result: null,
        },
      });
      await (prisma as any).taskStep.deleteMany({ where: { taskId: id } });
      await (prisma as any).artifact.deleteMany({ where: { taskId: id } });
    }

    // Add to queue
    const queue = getTaskQueue();
    if (queue) {
      await queue.add('execute', { taskId: id }, {
        jobId: id,
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    }

    await request.audit('task.run', 'task', id, { force });

    return reply.send({
      success: true,
      data: {
        id: task.id,
        status: 'QUEUED',
        message: 'Task queued for execution',
      },
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // GET /v1/tasks/:id - Get task status
  fastify.get('/tasks/:id', {
    schema: {
      description: 'Get task status and details',
      security: [{ apiKey: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const task = await (prisma as any).task.findFirst({
      where: { id },
      include: {
        project: true,
        steps: {
          orderBy: { index: 'asc' },
        },
        artifacts: true,
      },
    });

    if (!task || (task as any).project.orgId !== request.apiKey!.orgId) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Task not found' },
      });
    }

    return reply.send({
      success: true,
      data: {
        id: task.id,
        projectId: task.projectId,
        goal: task.goal,
        type: task.type,
        status: task.status,
        workspacePath: task.workspacePath,
        result: task.result,
        error: task.error,
        startedAt: task.startedAt?.toISOString(),
        completedAt: task.completedAt?.toISOString(),
        createdAt: task.createdAt.toISOString(),
        steps: (task as any).steps.map((s: any) => ({
          index: s.index,
          name: s.name,
          description: s.description,
          tool: s.tool,
          status: s.status,
          error: s.error,
          startedAt: s.startedAt?.toISOString(),
          completedAt: s.completedAt?.toISOString(),
        })),
        artifacts: (task as any).artifacts.map((a: any) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          size: a.size,
          createdAt: a.createdAt.toISOString(),
        })),
      },
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // GET /v1/usage - Get usage summary
  fastify.get('/usage', {
    schema: {
      description: 'Get usage summary for the organization',
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
        },
      },
    },
  }, async (request, reply) => {
    const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };

    const where: any = { orgId: request.apiKey!.orgId };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [events, taskCount, totalTokens, totalCost] = await Promise.all([
      (prisma as any).usageEvent.count({ where }),
      (prisma as any).task.count({
        where: {
          project: { orgId: request.apiKey!.orgId },
          ...(startDate || endDate ? { createdAt: where.createdAt } : {}),
        },
      }),
      (prisma as any).usageEvent.aggregate({
        where,
        _sum: { tokens: true },
      }),
      (prisma as any).usageEvent.aggregate({
        where,
        _sum: { cost: true },
      }),
    ]);

    return reply.send({
      success: true,
      data: {
        period: {
          start: startDate || 'all-time',
          end: endDate || 'now',
        },
        tasks: taskCount,
        events,
        tokens: totalTokens._sum.tokens || 0,
        cost: totalCost._sum.cost || 0,
      },
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });
};
