import { FastifyPluginAsync } from 'fastify';
import { prisma } from '@zyphon/db';

const OLLAMA_URL = process.env['OLLAMA_URL'] || 'http://localhost:11434';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', {
    schema: {
      description: 'Health check endpoint',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            checks: {
              type: 'object',
              properties: {
                database: { type: 'string' },
                ollama: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const checks: Record<string, string> = {};

    // Check database
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'healthy';
    } catch {
      checks['database'] = 'unhealthy';
    }

    // Check Ollama
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
      checks['ollama'] = res.ok ? 'healthy' : 'unhealthy';
    } catch {
      checks['ollama'] = 'unhealthy';
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks,
    };
  });

  fastify.get('/ready', async () => {
    return { ready: true };
  });

  fastify.get('/live', async () => {
    return { live: true };
  });
};
