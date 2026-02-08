import { FastifyPluginAsync } from 'fastify';
import { prisma } from '@zyphon/db';
import { CreateOrgSchema, CreateProjectSchema, CreateApiKeySchema, API_KEY_PREFIX, API_KEY_LENGTH } from '@zyphon/shared';
import { createHash, randomBytes } from 'crypto';

function generateApiKey(): { key: string; prefix: string; last4: string; hash: string } {
  const random = randomBytes(API_KEY_LENGTH).toString('base64url').substring(0, API_KEY_LENGTH);
  const key = `${API_KEY_PREFIX}${random}`;
  const prefix = key.substring(0, 7);
  const last4 = key.substring(key.length - 4);
  const hash = createHash('sha256').update(key).digest('hex');

  return { key, prefix, last4, hash };
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // Development-only: Skip auth for initial setup
  const skipAuth = process.env['NODE_ENV'] === 'development' && process.env['SKIP_ADMIN_AUTH'] === 'true';

  if (!skipAuth) {
    fastify.addHook('preHandler', async (request) => {
      await (fastify as any).requireAdmin(request);
    });
  }

  // POST /admin/orgs - Create organization
  fastify.post('/orgs', {
    schema: {
      description: 'Create a new organization',
      body: {
        type: 'object',
        required: ['name', 'slug'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          slug: { type: 'string', minLength: 1, maxLength: 50, pattern: '^[a-z0-9-]+$' },
        },
      },
    },
  }, async (request, reply) => {
    const input = CreateOrgSchema.parse(request.body);

    // Check slug uniqueness
    const existing = await (prisma as any).organization.findUnique({
      where: { slug: input.slug },
    });

    if (existing) {
      return reply.status(409).send({
        success: false,
        error: { code: 'CONFLICT', message: 'Organization slug already exists' },
      });
    }

    const org = await (prisma as any).organization.create({
      data: {
        name: input.name,
        slug: input.slug,
      },
    });

    return reply.status(201).send({
      success: true,
      data: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdAt: org.createdAt.toISOString(),
      },
    });
  });

  // GET /admin/orgs - List organizations
  fastify.get('/orgs', {
    schema: {
      description: 'List all organizations',
    },
  }, async (request, reply) => {
    const orgs = await (prisma as any).organization.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({
      success: true,
      data: orgs.map((o: any) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        createdAt: o.createdAt.toISOString(),
      })),
    });
  });

  // POST /admin/projects - Create project
  fastify.post('/projects', {
    schema: {
      description: 'Create a new project',
      body: {
        type: 'object',
        required: ['orgId', 'name'],
        properties: {
          orgId: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    const input = CreateProjectSchema.parse(request.body);

    // Verify org exists
    const org = await (prisma as any).organization.findUnique({
      where: { id: input.orgId, deletedAt: null },
    });

    if (!org) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
    }

    const project = await (prisma as any).project.create({
      data: {
        orgId: input.orgId,
        name: input.name,
        description: input.description,
      },
    });

    return reply.status(201).send({
      success: true,
      data: {
        id: project.id,
        orgId: project.orgId,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt.toISOString(),
      },
    });
  });

  // GET /admin/projects - List projects
  fastify.get('/projects', {
    schema: {
      description: 'List all projects',
      querystring: {
        type: 'object',
        properties: {
          orgId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { orgId } = request.query as { orgId?: string };

    const projects = await (prisma as any).project.findMany({
      where: {
        deletedAt: null,
        ...(orgId ? { orgId } : {}),
      },
      include: { org: true },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({
      success: true,
      data: projects.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        org: { id: p.org.id, name: p.org.name },
        createdAt: p.createdAt.toISOString(),
      })),
    });
  });

  // POST /admin/api-keys - Create API key
  fastify.post('/api-keys', {
    schema: {
      description: 'Create a new API key',
      body: {
        type: 'object',
        required: ['orgId', 'name'],
        properties: {
          orgId: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          scopes: { type: 'array', items: { type: 'string' } },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (request, reply) => {
    const input = CreateApiKeySchema.parse(request.body);

    // Verify org exists
    const org = await (prisma as any).organization.findUnique({
      where: { id: input.orgId, deletedAt: null },
    });

    if (!org) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
    }

    const { key, prefix, last4, hash } = generateApiKey();

    const apiKey = await (prisma as any).apiKey.create({
      data: {
        orgId: input.orgId,
        name: input.name,
        prefix,
        keyHash: hash,
        last4,
        scopes: input.scopes,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });

    // Return the full key ONLY on creation
    return reply.status(201).send({
      success: true,
      data: {
        id: apiKey.id,
        name: apiKey.name,
        key, // Full key - only shown once!
        prefix: apiKey.prefix,
        last4: apiKey.last4,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt?.toISOString(),
        createdAt: apiKey.createdAt.toISOString(),
      },
      meta: {
        warning: 'Save this key now. It will not be shown again.',
      },
    });
  });

  // GET /admin/api-keys - List API keys
  fastify.get('/api-keys', {
    schema: {
      description: 'List API keys',
      querystring: {
        type: 'object',
        properties: {
          orgId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { orgId } = request.query as { orgId?: string };

    const apiKeys = await (prisma as any).apiKey.findMany({
      where: {
        ...(orgId ? { orgId } : {}),
      },
      include: { org: true },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({
      success: true,
      data: apiKeys.map((k: any) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        last4: k.last4,
        scopes: k.scopes,
        org: { id: k.org.id, name: k.org.name },
        expiresAt: k.expiresAt?.toISOString(),
        revokedAt: k.revokedAt?.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString(),
        createdAt: k.createdAt.toISOString(),
      })),
    });
  });

  // POST /admin/api-keys/:id/revoke - Revoke API key
  fastify.post('/api-keys/:id/revoke', {
    schema: {
      description: 'Revoke an API key',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const apiKey = await (prisma as any).apiKey.findUnique({
      where: { id },
    });

    if (!apiKey) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found' },
      });
    }

    if (apiKey.revokedAt) {
      return reply.status(400).send({
        success: false,
        error: { code: 'ALREADY_REVOKED', message: 'API key already revoked' },
      });
    }

    await (prisma as any).apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    return reply.send({
      success: true,
      data: { id, revoked: true },
    });
  });

  // GET /admin/audit - Get audit logs
  fastify.get('/audit', {
    schema: {
      description: 'Get audit logs',
      querystring: {
        type: 'object',
        properties: {
          orgId: { type: 'string', format: 'uuid' },
          action: { type: 'string' },
          resource: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { orgId, action, resource, limit = 50, offset = 0 } = request.query as {
      orgId?: string;
      action?: string;
      resource?: string;
      limit?: number;
      offset?: number;
    };

    const where: any = {};
    if (orgId) where.orgId = orgId;
    if (action) where.action = action;
    if (resource) where.resource = resource;

    const [logs, total] = await Promise.all([
      (prisma as any).auditLog.findMany({
        where,
        include: { org: true, user: true, apiKey: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      (prisma as any).auditLog.count({ where }),
    ]);

    return reply.send({
      success: true,
      data: logs.map((l: any) => ({
        id: l.id,
        action: l.action,
        resource: l.resource,
        resourceId: l.resourceId,
        details: l.details,
        org: { id: l.org.id, name: l.org.name },
        user: l.user ? { id: l.user.id, email: l.user.email } : null,
        apiKey: l.apiKey ? { id: l.apiKey.id, name: l.apiKey.name, prefix: l.apiKey.prefix } : null,
        ip: l.ip,
        createdAt: l.createdAt.toISOString(),
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + logs.length < total,
      },
    });
  });

  // GET /admin/tasks - List all tasks
  fastify.get('/tasks', {
    schema: {
      description: 'List all tasks',
      querystring: {
        type: 'object',
        properties: {
          orgId: { type: 'string', format: 'uuid' },
          projectId: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['QUEUED', 'PLANNED', 'RUNNING', 'SUCCEEDED', 'FAILED'] },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { orgId, projectId, status, limit = 20, offset = 0 } = request.query as {
      orgId?: string;
      projectId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    };

    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (orgId) where.project = { orgId };

    const [tasks, total] = await Promise.all([
      (prisma as any).task.findMany({
        where,
        include: {
          project: { include: { org: true } },
          _count: { select: { steps: true, artifacts: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      (prisma as any).task.count({ where }),
    ]);

    return reply.send({
      success: true,
      data: tasks.map((t: any) => ({
        id: t.id,
        goal: t.goal.substring(0, 100),
        type: t.type,
        status: t.status,
        project: { id: t.project.id, name: t.project.name },
        org: { id: t.project.org.id, name: t.project.org.name },
        stepCount: t._count.steps,
        artifactCount: t._count.artifacts,
        startedAt: t.startedAt?.toISOString(),
        completedAt: t.completedAt?.toISOString(),
        createdAt: t.createdAt.toISOString(),
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + tasks.length < total,
      },
    });
  });
};
