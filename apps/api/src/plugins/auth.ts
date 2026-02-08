import { FastifyPluginCallback, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '@zyphon/db';
import { createHash } from 'crypto';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: {
      id: string;
      orgId: string;
      scopes: string[];
    };
    user?: {
      id: string;
      email: string;
      orgId: string;
      role: string;
    };
  }
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

const authPluginCallback: FastifyPluginCallback = (fastify, _opts, done) => {
  // Decorator for API key auth
  fastify.decorate('requireApiKey', async function (request: FastifyRequest) {
    const apiKeyHeader = request.headers['x-api-key'] as string | undefined;

    if (!apiKeyHeader) {
      throw { statusCode: 401, message: 'API key required' };
    }

    // Extract prefix from key
    const prefix = apiKeyHeader.substring(0, 7); // "zk_xxx_"
    const keyHash = hashApiKey(apiKeyHeader);

    const apiKey = await (prisma as any).apiKey.findFirst({
      where: {
        prefix,
        keyHash,
        revokedAt: null,
      },
    });

    if (!apiKey) {
      throw { statusCode: 401, message: 'Invalid API key' };
    }

    // Check expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw { statusCode: 401, message: 'API key expired' };
    }

    // Update last used
    await (prisma as any).apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    request.apiKey = {
      id: apiKey.id,
      orgId: apiKey.orgId,
      scopes: apiKey.scopes,
    };
  });

  // Decorator for admin auth (placeholder - would use JWT/session in production)
  fastify.decorate('requireAdmin', async function (request: FastifyRequest) {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw { statusCode: 401, message: 'Authorization required' };
    }

    const token = authHeader.substring(7);

    // For development, accept a simple admin token
    // In production, this would validate a JWT
    if (token === process.env['ADMIN_TOKEN'] || token === 'dev-admin-token') {
      // Get first admin user (development only)
      const user = await (prisma as any).user.findFirst({
        include: {
          memberships: {
            where: { role: 'OWNER' },
            include: { org: true },
          },
        },
      });

      if (user && (user as any).memberships[0]) {
        request.user = {
          id: user.id,
          email: user.email,
          orgId: (user as any).memberships[0].orgId,
          role: (user as any).memberships[0].role,
        };
        return;
      }
    }

    throw { statusCode: 401, message: 'Invalid authorization' };
  });

  done();
};

export const authPlugin = fp(authPluginCallback, {
  name: 'auth',
});
