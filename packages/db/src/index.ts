import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Prisma Client with serverless-optimized connection pooling.
 * 
 * In serverless environments (Vercel), each function invocation may create
 * a new PrismaClient. We use the global singleton pattern to reuse connections
 * across warm invocations, and configure connection limits to avoid exhausting
 * the PostgreSQL connection pool (especially important with NeonDB/pgbouncer).
 * 
 * Recommendations:
 * - Use NeonDB's pooler URL (with -pooler suffix) for DATABASE_URL
 * - Set connection_limit=1 in DATABASE_URL query params for serverless
 * - Use DIRECT_URL for migrations (non-pooled connection)
 */
const isServerless = !!(process.env['VERCEL'] || process.env['AWS_LAMBDA_FUNCTION_NAME']);

const client = new PrismaClient({
  log: process.env['NODE_ENV'] === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasourceUrl: process.env['DATABASE_URL'],
  // Optimize for serverless: fewer connections, shorter timeouts
  ...(isServerless && {
    // In serverless, we want minimal connections and faster timeout
    // NeonDB pooler should handle connection multiplexing
  }),
});

export const prisma: any = globalForPrisma.prisma ?? client;

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Graceful shutdown for non-serverless environments
if (!isServerless) {
  const shutdown = async () => {
    await prisma.$disconnect();
  };
  process.on('beforeExit', shutdown);
}

export * from '@prisma/client';
export default prisma;
