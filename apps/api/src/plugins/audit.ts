import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '@zyphon/db';

declare module 'fastify' {
  interface FastifyRequest {
    audit: (action: string, resource: string, resourceId?: string, details?: unknown) => Promise<void>;
  }
}

const auditPluginCallback: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.decorateRequest('audit', null);

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    request.audit = async (action: string, resource: string, resourceId?: string, details?: unknown) => {
      const orgId = request.apiKey?.orgId || request.user?.orgId;

      if (!orgId) {
        return; // Can't audit without org context
      }

      await prisma.auditLog.create({
        data: {
          orgId,
          userId: request.user?.id,
          apiKeyId: request.apiKey?.id,
          action,
          resource,
          resourceId,
          details: details as object,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
      });
    };
  });

  done();
};

export const auditPlugin = fp(auditPluginCallback, {
  name: 'audit',
});
