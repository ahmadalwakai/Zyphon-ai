import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { requestIdPlugin } from './plugins/request-id.js';
import { authPlugin } from './plugins/auth.js';
import { auditPlugin } from './plugins/audit.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin.js';
import { healthRoutes } from './routes/health.js';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({
  name: 'zyphon-api',
  level: process.env['LOG_LEVEL'] || 'info',
});

const PORT = parseInt(process.env['API_PORT'] || '3002', 10);
const HOST = process.env['API_HOST'] || '0.0.0.0';

async function main() {
  const app = Fastify({
    logger: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  // Security
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: process.env['CORS_ORIGIN'] || true,
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      return (req.headers['x-api-key'] as string) || req.ip;
    },
  });

  // OpenAPI / Swagger
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Zyphon API',
        description: 'AI Agent Platform API',
        version: '1.0.0',
      },
      servers: [
        { url: `http://localhost:${PORT}`, description: 'Development' },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            name: 'x-api-key',
            in: 'header',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // Custom plugins
  await app.register(requestIdPlugin);
  await app.register(authPlugin);
  await app.register(auditPlugin);

  // Routes
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(publicRoutes, { prefix: '/v1' });
  await app.register(adminRoutes, { prefix: '/admin' });

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;

    logger.error({
      requestId: request.id,
      error: error.message,
      stack: error.stack,
    }, 'Request error');

    reply.status(statusCode).send({
      success: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: statusCode === 500 ? 'Internal server error' : error.message,
      },
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Start server
  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info(`
╔═══════════════════════════════════════════════════════════════╗
║                     ZYPHON API SERVER                         ║
╠═══════════════════════════════════════════════════════════════╣
║  API:     http://localhost:${PORT}                              ║
║  Docs:    http://localhost:${PORT}/docs                         ║
║  Health:  http://localhost:${PORT}/health                       ║
╚═══════════════════════════════════════════════════════════════╝
    `);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main();
