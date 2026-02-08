/**
 * Zyphon Production Configuration
 * All costs, limits, and guardrails in one place.
 * DO NOT hard-code values elsewhere.
 */

// ============================================
// CREDIT COSTS
// ============================================

export const CREDIT_COSTS = {
  // Image generation (high cost)
  IMAGE_GEN: 50,
  
  // LLM tokens (per 1000 tokens)
  LLM_INPUT_PER_1K: 1,
  LLM_OUTPUT_PER_1K: 3,
  
  // Time-based costs (per minute)
  TERMINAL_PER_MINUTE: 2,
  BROWSER_PER_MINUTE: 5,
  
  // Base costs
  TASK_BASE: 5,
  STEP_BASE: 1,
} as const;

// ============================================
// PLAN LIMITS
// ============================================

export const PLAN_LIMITS = {
  // User plan credit allocations
  FREE: {
    monthlyCredits: 100,
    maxConcurrentTasks: 1,
    maxStepsPerTask: 8,
    maxSecondsPerTask: 300,
  },
  PRO: {
    monthlyCredits: 2000,
    maxConcurrentTasks: 3,
    maxStepsPerTask: 16,
    maxSecondsPerTask: 600,
  },
  UNLIMITED: {
    monthlyCredits: 999999,
    maxConcurrentTasks: 10,
    maxStepsPerTask: 32,
    maxSecondsPerTask: 1800,
  },
} as const;

// ============================================
// AGENT LIMITS
// ============================================

export const AGENT_LIMITS = {
  // Per-task limits
  maxStepsPerTask: 16,
  maxWallClockSeconds: 600,
  maxRetriesPerStep: 1,
  maxConcurrentTasksPerUser: 3,
  
  // Output limits
  maxOutputSizeBytes: 10 * 1024 * 1024, // 10MB
  maxTerminalOutputChars: 100000,
  maxArtifactsPerTask: 50,
} as const;

// ============================================
// TERMINAL GUARDRAILS
// ============================================

export const TERMINAL_GUARDRAILS = {
  // Hard timeout per command
  timeoutMs: 60 * 1000, // 60 seconds
  
  // Max output size
  maxOutputChars: 100000,
  
  // Strict allowlist only (no arbitrary shell)
  allowlist: [
    // Package managers
    'pnpm install',
    'pnpm lint',
    'pnpm test',
    'pnpm build',
    'pnpm dev',
    'pnpm run',
    'npm install',
    'npm lint',
    'npm test',
    'npm build',
    'npm run',
    'yarn install',
    'yarn lint',
    'yarn test',
    'yarn build',
    'yarn run',
    
    // Version checks
    'node -v',
    'node --version',
    'pnpm -v',
    'npm -v',
    
    // Prisma
    'npx prisma generate',
    'npx prisma migrate',
    'npx prisma db push',
    
    // Git (read-only)
    'git status',
    'git log',
    'git diff',
    
    // File operations (safe)
    'ls',
    'dir',
    'cat',
    'type',
    'echo',
    'pwd',
    'mkdir',
  ],
  
  // Blocklist patterns (security critical)
  blocklist: [
    'rm -rf',
    'rm -r',
    'rmdir /s',
    'del /s',
    'del /q',
    'format',
    'mkfs',
    'dd',
    'shutdown',
    'reboot',
    'reg',
    'regedit',
    'powershell -enc',
    'powershell -e',
    'curl | bash',
    'curl | sh',
    'wget | bash',
    'wget | sh',
    'chmod 777',
    ':(){:|:&};:',
    '> /dev/sda',
    'sudo',
    'su -',
    'eval',
    'exec',
    '$(',
    '`',
    '|',
    '>',
    '<',
    '&&',
    '||',
    ';',
  ],
} as const;

// ============================================
// BROWSER GUARDRAILS
// ============================================

export const BROWSER_GUARDRAILS = {
  // Headless only (no visible browser)
  headless: true,
  
  // Timeout per action
  timeoutMs: 30 * 1000, // 30 seconds
  
  // Allowed domains (screenshot-only output)
  allowedDomains: [
    'localhost',
    '127.0.0.1',
    // User-requested URLs are validated at runtime
  ],
  
  // No downloads allowed
  allowDownloads: false,
  
  // Screenshot resolution limits
  maxWidth: 1920,
  maxHeight: 1080,
} as const;

// ============================================
// RATE LIMITS
// ============================================

export const RATE_LIMITS = {
  // Tasks per minute per user
  tasksPerMinute: 5,
  
  // Tasks per day per user
  tasksPerDay: 100,
  
  // API requests per minute
  apiRequestsPerMinute: 60,
  
  // Abuse detection thresholds
  abuseThresholds: {
    // Flag if user creates more than X tasks in Y minutes
    taskSpamTasks: 10,
    taskSpamMinutes: 5,
    
    // Flag if task runs longer than X minutes
    longRunMinutes: 30,
    
    // Flag if user has X failed tasks in Y minutes
    failedTasksCount: 5,
    failedTasksMinutes: 10,
  },
} as const;

// ============================================
// SD3 IMAGE GENERATION
// ============================================

export const SD3_CONFIG = {
  // Required environment variables
  requiredEnvVars: ['SD3_SCRIPT_PATH', 'SD3_MODEL_PATH'],
  
  // Supported dimensions
  supportedWidths: [512, 768, 1024, 1280, 1536, 1920],
  supportedHeights: [512, 768, 1024, 1280, 1536, 1080],
  
  // Default settings
  defaultWidth: 1024,
  defaultHeight: 1024,
  defaultSteps: 20,
  
  // Limits
  maxSteps: 50,
  minSteps: 10,
  
  // Timeout
  timeoutMs: 10 * 60 * 1000, // 10 minutes
  
  // Retry count
  maxRetries: 1,
} as const;

// ============================================
// TASK LIFECYCLE STATES
// ============================================

export const TASK_STATES = {
  QUEUED: 'QUEUED',
  PLANNED: 'PLANNED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TIMED_OUT: 'TIMED_OUT',
} as const;

export const STEP_STATES = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  CANCELLED: 'CANCELLED',
} as const;

// ============================================
// ERROR CODES (Structured, no prose)
// ============================================

export const ERROR_CODES = {
  // Credit errors
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  CREDIT_PREAUTH_FAILED: 'CREDIT_PREAUTH_FAILED',
  
  // Safety errors
  COMMAND_BLOCKED: 'COMMAND_BLOCKED',
  COMMAND_NOT_ALLOWED: 'COMMAND_NOT_ALLOWED',
  DOMAIN_NOT_ALLOWED: 'DOMAIN_NOT_ALLOWED',
  TIMEOUT_EXCEEDED: 'TIMEOUT_EXCEEDED',
  OUTPUT_TOO_LARGE: 'OUTPUT_TOO_LARGE',
  
  // SD3 errors
  SD3_NOT_CONFIGURED: 'SD3_NOT_CONFIGURED',
  SD3_MODEL_NOT_FOUND: 'SD3_MODEL_NOT_FOUND',
  SD3_SCRIPT_NOT_FOUND: 'SD3_SCRIPT_NOT_FOUND',
  SD3_GENERATION_FAILED: 'SD3_GENERATION_FAILED',
  
  // Limit errors
  MAX_STEPS_EXCEEDED: 'MAX_STEPS_EXCEEDED',
  MAX_TIME_EXCEEDED: 'MAX_TIME_EXCEEDED',
  MAX_RETRIES_EXCEEDED: 'MAX_RETRIES_EXCEEDED',
  MAX_CONCURRENT_TASKS_EXCEEDED: 'MAX_CONCURRENT_TASKS_EXCEEDED',
  
  // Verification errors
  REQUIRED_ARTIFACTS_MISSING: 'REQUIRED_ARTIFACTS_MISSING',
  STEP_FAILED: 'STEP_FAILED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  
  // System errors
  WORKER_NOT_AVAILABLE: 'WORKER_NOT_AVAILABLE',
  REDIS_NOT_AVAILABLE: 'REDIS_NOT_AVAILABLE',
  DATABASE_ERROR: 'DATABASE_ERROR',
  OLLAMA_NOT_AVAILABLE: 'OLLAMA_NOT_AVAILABLE',
  PLAYWRIGHT_NOT_INSTALLED: 'PLAYWRIGHT_NOT_INSTALLED',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

// ============================================
// STARTUP CHECKS
// ============================================

export interface StartupCheckResult {
  name: string;
  passed: boolean;
  message: string;
  critical: boolean;
}

export const STARTUP_CHECKS = {
  redis: {
    name: 'Redis Connection',
    critical: true,
  },
  ollama: {
    name: 'Ollama LLM',
    critical: true,
  },
  sd3Model: {
    name: 'SD3 Model Path',
    critical: false, // Warn but don't fail
  },
  sd3Script: {
    name: 'SD3 Script Path',
    critical: false,
  },
  playwright: {
    name: 'Playwright Browsers',
    critical: false,
  },
  database: {
    name: 'Database Connection',
    critical: true,
  },
} as const;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate estimated credits for a task based on type and constraints
 */
export function estimateTaskCredits(
  type: 'CODING' | 'IMAGE' | 'MIXED',
  maxSteps: number
): number {
  let estimate = CREDIT_COSTS.TASK_BASE;
  
  switch (type) {
    case 'IMAGE':
      estimate += CREDIT_COSTS.IMAGE_GEN;
      break;
    case 'MIXED':
      estimate += CREDIT_COSTS.IMAGE_GEN + (maxSteps * CREDIT_COSTS.STEP_BASE);
      break;
    case 'CODING':
    default:
      estimate += maxSteps * CREDIT_COSTS.STEP_BASE;
      estimate += maxSteps * CREDIT_COSTS.LLM_OUTPUT_PER_1K; // Rough estimate
      break;
  }
  
  return estimate;
}

/**
 * Check if a command is allowed by the terminal guardrails
 */
export function isCommandAllowed(command: string): { allowed: boolean; error?: string } {
  const normalized = command.toLowerCase().trim();
  
  // Check blocklist first (security critical)
  for (const blocked of TERMINAL_GUARDRAILS.blocklist) {
    if (normalized.includes(blocked.toLowerCase())) {
      return {
        allowed: false,
        error: `${ERROR_CODES.COMMAND_BLOCKED}: Pattern "${blocked}" is blocked`,
      };
    }
  }
  
  // Check if command matches any allowlist pattern
  const isAllowed = TERMINAL_GUARDRAILS.allowlist.some(allowed => {
    const normalizedAllowed = allowed.toLowerCase();
    return normalized.startsWith(normalizedAllowed) || normalized === normalizedAllowed;
  });
  
  if (!isAllowed) {
    return {
      allowed: false,
      error: `${ERROR_CODES.COMMAND_NOT_ALLOWED}: Command not in allowlist`,
    };
  }
  
  return { allowed: true };
}

/**
 * Check if a URL domain is allowed
 */
export function isDomainAllowed(url: string, additionalDomains: string[] = []): boolean {
  try {
    // Parse URL manually to avoid global URL dependency
    const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/:]+)/i);
    if (!match || !match[1]) return false;
    
    const domain = match[1].toLowerCase();
    const allAllowed = [...BROWSER_GUARDRAILS.allowedDomains, ...additionalDomains];
    return allAllowed.some(allowed => domain === allowed || domain.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}
