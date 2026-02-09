import { NextResponse } from 'next/server';
import { prisma } from '@zyphon/db';

export const dynamic = 'force-dynamic';

function getEnvSummary(): Record<string, string> {
  return {
    NODE_ENV: process.env['NODE_ENV'] || 'undefined',
    VERCEL: process.env['VERCEL'] ? 'true' : 'false',
    DATABASE_URL: process.env['DATABASE_URL'] ? '***configured***' : 'MISSING',
    REDIS_URL: process.env['REDIS_URL'] ? '***configured***' : 'using default',
    OLLAMA_BASE_URL: (process.env['OLLAMA_BASE_URL'] || process.env['OLLAMA_URL']) ? '***configured***' : 'using default',
    OLLAMA_MODEL: process.env['OLLAMA_MODEL'] || 'default (deepseek-coder-v2:16b)',
    WORKSPACE_ROOT: process.env['WORKSPACE_ROOT'] || (process.env['VERCEL'] ? '/tmp/workspaces' : './workspaces'),
    SD3_SCRIPT_PATH: process.env['SD3_SCRIPT_PATH'] ? '***configured***' : 'not set',
    SD3_MODEL_PATH: process.env['SD3_MODEL_PATH'] ? '***configured***' : 'not set',
    CRON_SECRET: process.env['CRON_SECRET'] ? '***configured***' : 'not set',
  };
}

/**
 * Health check endpoint for monitoring.
 * 
 * Reports status of:
 * - Database connectivity
 * - LLM service (Ollama) availability
 * - Environment configuration
 * - Vercel function region
 */
export async function GET() {
  const startTime = Date.now();
  const checks: Record<string, { status: string; latency?: number; error?: string }> = {};

  // 1. Database check
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok', latency: Date.now() - dbStart };
  } catch (error) {
    checks.database = { 
      status: 'error', 
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }

  // 2. LLM (Ollama) check
  const ollamaUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_URL || 'http://localhost:11434';
  try {
    const llmStart = Date.now();
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json();
      checks.ollama = { 
        status: 'ok', 
        latency: Date.now() - llmStart,
      };
    } else {
      checks.ollama = { status: 'degraded', error: `HTTP ${response.status}` };
    }
  } catch (error) {
    checks.ollama = { 
      status: 'unreachable', 
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }

  // 3. Redis check (if configured)
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      // Simple connectivity test via fetch for Upstash REST API
      // For ioredis-based Redis, this is checked by the worker
      checks.redis = { status: 'configured' };
    } catch {
      checks.redis = { status: 'error' };
    }
  } else {
    checks.redis = { status: 'not_configured' };
  }

  // Overall status
  const isHealthy = checks.database?.status === 'ok';
  const totalLatency = Date.now() - startTime;

  return NextResponse.json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    latency: totalLatency,
    region: process.env.VERCEL_REGION || 'unknown',
    checks,
    env: getEnvSummary(),
  }, {
    status: isHealthy ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
