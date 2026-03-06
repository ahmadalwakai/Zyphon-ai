/**
 * Environment variable validation and runtime configuration.
 * 
 * Validates required env vars at startup and provides typed access.
 * Prevents cryptic "fetch failed" errors by failing fast with clear messages.
 */

export interface EnvConfig {
  // Required
  DATABASE_URL: string;
  
  // LLM Provider config
  LLM_PROVIDER: 'groq' | 'ollama';
  GROQ_API_KEY?: string;
  GROQ_MODEL: string;
  GROQ_BASE_URL: string;
  
  // Optional with defaults (legacy Ollama)
  REDIS_URL: string;
  OLLAMA_BASE_URL: string;
  OLLAMA_MODEL: string;
  WORKSPACE_ROOT: string;
  
  // Optional
  NEXT_PUBLIC_API_URL?: string;
  API_URL?: string;
  SD3_SCRIPT_PATH?: string;
  SD3_MODEL_PATH?: string;
  CRON_SECRET?: string;
  FEATURE_B2B?: boolean;
  
  // Computed
  isVercel: boolean;
  isProduction: boolean;
  isDevelopment: boolean;
}

export class EnvValidationError extends Error {
  public missingVars: string[];
  
  constructor(missingVars: string[]) {
    super(`Missing required environment variables: ${missingVars.join(', ')}`);
    this.name = 'EnvValidationError';
    this.missingVars = missingVars;
  }
}

/**
 * Validate and return typed environment configuration.
 * Call at application startup to fail fast on missing config.
 */
export function validateEnv(options: { requireRedis?: boolean; requireOllama?: boolean; requireLLM?: boolean } = {}): EnvConfig {
  const missing: string[] = [];
  
  // Always required
  if (!process.env['DATABASE_URL']) {
    missing.push('DATABASE_URL');
  }
  
  // Conditionally required
  if (options.requireRedis && !process.env['REDIS_URL']) {
    missing.push('REDIS_URL');
  }
  
  // LLM provider logic
  const llmProvider = (process.env['LLM_PROVIDER'] || 'groq') as 'groq' | 'ollama';
  
  if (options.requireLLM || options.requireOllama) {
    if (llmProvider === 'groq' && !process.env['GROQ_API_KEY']) {
      missing.push('GROQ_API_KEY');
    } else if (llmProvider === 'ollama' && !process.env['OLLAMA_BASE_URL'] && !process.env['OLLAMA_URL']) {
      missing.push('OLLAMA_BASE_URL or OLLAMA_URL');
    }
  }
  
  if (missing.length > 0) {
    throw new EnvValidationError(missing);
  }
  
  const isVercel = !!process.env['VERCEL'];
  
  return {
    DATABASE_URL: process.env['DATABASE_URL']!,
    LLM_PROVIDER: llmProvider,
    GROQ_API_KEY: process.env['GROQ_API_KEY'],
    GROQ_MODEL: process.env['GROQ_MODEL'] || 'llama-3.3-70b-versatile',
    GROQ_BASE_URL: process.env['GROQ_BASE_URL'] || 'https://api.groq.com/openai/v1',
    REDIS_URL: process.env['REDIS_URL'] || 'redis://localhost:6379',
    OLLAMA_BASE_URL: process.env['OLLAMA_BASE_URL'] || process.env['OLLAMA_URL'] || 'http://localhost:11434',
    OLLAMA_MODEL: process.env['OLLAMA_MODEL'] || 'deepseek-coder-v2:16b',
    WORKSPACE_ROOT: process.env['WORKSPACE_ROOT'] || (isVercel ? '/tmp/workspaces' : './workspaces'),
    NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'],
    API_URL: process.env['API_URL'],
    SD3_SCRIPT_PATH: process.env['SD3_SCRIPT_PATH'],
    SD3_MODEL_PATH: process.env['SD3_MODEL_PATH'],
    CRON_SECRET: process.env['CRON_SECRET'],
    FEATURE_B2B: process.env['FEATURE_B2B'] === 'true',
    isVercel,
    isProduction: process.env['NODE_ENV'] === 'production',
    isDevelopment: process.env['NODE_ENV'] === 'development',
  };
}

/**
 * Quick check if we're in a serverless environment.
 * Useful for conditional logic without full validation.
 */
export function isServerless(): boolean {
  return !!(process.env['VERCEL'] || process.env['AWS_LAMBDA_FUNCTION_NAME'] || process.env['NETLIFY']);
}

/**
 * Get a safe summary of env config (no secrets) for debugging.
 */
export function getEnvSummary(): Record<string, string> {
  const llmProvider = process.env['LLM_PROVIDER'] || 'groq';
  return {
    NODE_ENV: process.env['NODE_ENV'] || 'undefined',
    VERCEL: process.env['VERCEL'] ? 'true' : 'false',
    DATABASE_URL: process.env['DATABASE_URL'] ? '***configured***' : 'MISSING',
    REDIS_URL: process.env['REDIS_URL'] ? '***configured***' : 'using default',
    LLM_PROVIDER: llmProvider,
    GROQ_API_KEY: process.env['GROQ_API_KEY'] ? '***configured***' : 'not set',
    GROQ_MODEL: process.env['GROQ_MODEL'] || 'default (llama-3.3-70b-versatile)',
    GROQ_BASE_URL: process.env['GROQ_BASE_URL'] || 'https://api.groq.com/openai/v1',
    OLLAMA_BASE_URL: (process.env['OLLAMA_BASE_URL'] || process.env['OLLAMA_URL']) ? '***configured***' : 'using default',
    OLLAMA_MODEL: process.env['OLLAMA_MODEL'] || 'default (deepseek-coder-v2:16b)',
    WORKSPACE_ROOT: process.env['WORKSPACE_ROOT'] || (process.env['VERCEL'] ? '/tmp/workspaces' : './workspaces'),
    SD3_SCRIPT_PATH: process.env['SD3_SCRIPT_PATH'] ? '***configured***' : 'not set',
    SD3_MODEL_PATH: process.env['SD3_MODEL_PATH'] ? '***configured***' : 'not set',
    CRON_SECRET: process.env['CRON_SECRET'] ? '***configured***' : 'not set',
    FEATURE_B2B: process.env['FEATURE_B2B'] || 'false',
  };
}
