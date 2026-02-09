import { z } from 'zod';

// ============================================
// PRODUCTION CONFIG (export all)
// ============================================

export * from './config.js';
export * from './env.js';

// ============================================
// ENUMS
// ============================================

export const RoleEnum = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'READONLY']);
export type Role = z.infer<typeof RoleEnum>;

export const TaskStatusEnum = z.enum(['QUEUED', 'PLANNED', 'RUNNING', 'SUCCEEDED', 'FAILED']);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

export const TaskTypeEnum = z.enum(['CODING', 'IMAGE', 'MIXED']);
export type TaskType = z.infer<typeof TaskTypeEnum>;

export const StepStatusEnum = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED']);
export type StepStatus = z.infer<typeof StepStatusEnum>;

export const ToolTypeEnum = z.enum(['LLM', 'IMAGE', 'FILE', 'SHELL', 'TERMINAL', 'BROWSER', 'WEB', 'FS', 'NONE']);
export type ToolType = z.infer<typeof ToolTypeEnum>;

// ============================================
// STEP TYPES (Manus-like brain)
// ============================================

export const StepTypeEnum = z.enum([
  'PLAN',           // Initial planning step
  'WEB_RESEARCH',   // Web research via search/fetch
  'IMAGE_GEN',      // Image generation via SD3
  'CODE_GEN',       // Code generation via LLM
  'TERMINAL_RUN',   // Terminal command execution
  'BROWSER_CHECK',  // Browser automation/screenshot
  'FS_WRITE',       // File system write
  'FS_READ',        // File system read
  'VERIFY',         // Critic verification step
]);
export type StepType = z.infer<typeof StepTypeEnum>;

// ============================================
// EXPECTED OUTPUT TYPES
// ============================================

export const ExpectedOutputEnum = z.enum(['code', 'image', 'text', 'files', 'web_result', 'browser_check', 'terminal']);
export type ExpectedOutput = z.infer<typeof ExpectedOutputEnum>;

// ============================================
// API SCHEMAS
// ============================================

export const CreateTaskSchema = z.object({
  projectId: z.string().uuid(),
  goal: z.string().min(1).max(2000),
  context: z.string().max(10000).optional(),
  type: TaskTypeEnum.optional().default('CODING'),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const RunTaskSchema = z.object({
  force: z.boolean().optional().default(false),
});
export type RunTaskInput = z.infer<typeof RunTaskSchema>;

export const CreateOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
});
export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;

export const CreateProjectSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const CreateApiKeySchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).optional().default(['tasks:read', 'tasks:write']),
  expiresAt: z.string().datetime().optional(),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

// ============================================
// RESPONSE TYPES
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================
// ENTITY TYPES
// ============================================

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: string;
  orgId: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface Task {
  id: string;
  projectId: string;
  goal: string;
  context: string | null;
  type: TaskType;
  status: TaskStatus;
  workspacePath: string;
  result: unknown | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskStep {
  id: string;
  taskId: string;
  index: number;
  name: string;
  description: string;
  tool: ToolType;
  input: unknown;
  output: unknown | null;
  status: StepStatus;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface Artifact {
  id: string;
  taskId: string;
  stepId: string | null;
  name: string;
  type: string;
  path: string;
  size: number;
  metadata: unknown | null;
  createdAt: Date;
}

export interface UsageEvent {
  id: string;
  orgId: string;
  apiKeyId: string | null;
  taskId: string | null;
  event: string;
  tokens: number;
  cost: number;
  metadata: unknown | null;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  orgId: string;
  userId: string | null;
  apiKeyId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  details: unknown | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

// ============================================
// USER SAAS TYPES
// ============================================

export const UserPlanEnum = z.enum(['FREE', 'PRO', 'UNLIMITED']);
export type UserPlan = z.infer<typeof UserPlanEnum>;

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  plan: UserPlan;
  credits: number;
  createdAt: Date;
}

export interface UserWorkspace {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserTask {
  id: string;
  workspaceId: string;
  goal: string;
  context: string | null;
  type: TaskType;
  status: TaskStatus;
  workspacePath: string;
  result: unknown | null;
  error: string | null;
  creditsUsed: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreditHistory {
  id: string;
  userId: string;
  amount: number;
  balance: number;
  reason: string;
  taskId: string | null;
  createdAt: Date;
}

// ============================================
// AGENT TYPES
// ============================================

export interface AgentPlan {
  taskId: string;
  goal: string;
  steps: AgentPlanStep[];
  createdAt: string;
}

export interface AgentPlanStep {
  index: number;
  name: string;
  description: string;
  tool: ToolType;
  input: unknown;
  dependsOn: number[];
}

// ============================================
// MANUS-LIKE BRAIN TYPES
// ============================================

/**
 * TaskSpec - Input specification for a task
 */
export interface TaskSpec {
  goal: string;
  context?: Record<string, unknown>;
  constraints?: TaskConstraints;
  expectedOutputs?: ExpectedOutput[];
}

export interface TaskConstraints {
  maxSteps?: number;       // Default 12
  maxSeconds?: number;     // Default 600
  maxCostCredits?: number; // Default unlimited
  allowWeb?: boolean;      // Default false (stub for now)
  allowTerminal?: boolean; // Default true
  allowBrowser?: boolean;  // Default true
}

export const DEFAULT_CONSTRAINTS: Required<TaskConstraints> = {
  maxSteps: 12,
  maxSeconds: 600,
  maxCostCredits: 1000,
  allowWeb: false,
  allowTerminal: true,
  allowBrowser: true,
};

/**
 * PlanStep - Single step in a plan (Manus-like structure)
 */
export interface PlanStep {
  id: string;                    // e.g., "s1", "s2"
  type: StepType;                // PLAN, IMAGE_GEN, CODE_GEN, etc.
  tool: ToolType;                // LLM, IMAGE, TERMINAL, BROWSER, etc.
  input: Record<string, unknown>;
  outputs?: {
    artifacts?: string[];        // Expected artifact names
    notes?: string;
  };
  acceptance?: string[];         // Acceptance criteria
  on_fail?: {
    retry?: number;              // Number of retries (default 1)
    fallback_step?: string;      // Step ID to run if this fails
  };
  dependsOn?: string[];          // IDs of steps this depends on
}

/**
 * ExecutionPlan - Full plan output from planner
 */
export interface ExecutionPlan {
  taskId: string;
  goal: string;
  expectedOutputs: ExpectedOutput[];
  steps: PlanStep[];
  constraints: Required<TaskConstraints>;
  createdAt: string;
}

/**
 * StepResult - Result of executing a single step
 */
export interface StepResult {
  stepId: string;
  status: StepStatus;
  result: ToolResult;
  retryCount: number;
  startedAt: string;
  completedAt: string;
}

/**
 * ExecutionContext - Context passed through execution
 */
export interface ExecutionContext {
  taskId: string;
  workspacePath: string;
  goal: string;
  constraints: Required<TaskConstraints>;
  previousOutputs: Map<string, unknown>;
  stepResults: Map<string, StepResult>;
  startTime: number;
  stepCount: number;
}

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
  duration: number;
  artifacts?: Array<{
    name: string;
    path: string;
    type: string;
    size: number;
  }>;
}

// ============================================
// CONSTANTS
// ============================================

// RATE_LIMITS is exported from config.ts - do not duplicate here

export const API_KEY_PREFIX = 'zk_';
export const API_KEY_LENGTH = 32;

export const TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (for slow local LLM + image generation)
export const LLM_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for slow local LLMs
export const IMAGE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ============================================
// INTENT CLASSIFICATION
// ============================================

export type ExpectedOutputType = 'TEXT' | 'IMAGE' | 'COMPOSITE';

export interface IntentClassification {
  expectedOutput: ExpectedOutputType;
  enforcedTool: ToolType | null;
  confidence: number;
  signals: string[];
  inferredOutputs: ExpectedOutput[]; // New: array of expected outputs
  isComposite: boolean;              // New: true if multiple output types needed
}

// Code/website intent detection patterns
const CODE_KEYWORDS = [
  'landing page', 'website', 'web page', 'webpage', 'next.js', 'nextjs',
  'react', 'component', 'create a page', 'build a page', 'code',
  'function', 'class', 'typescript', 'javascript', 'html', 'css',
  'api', 'endpoint', 'route', 'handler', 'app', 'application',
  'form', 'button', 'card', 'layout', 'navbar', 'sidebar', 'footer',
  'dashboard', 'ui', 'interface', 'frontend', 'backend',
];

// Terminal/build intent patterns
const TERMINAL_KEYWORDS = [
  'run tests', 'test', 'pnpm test', 'npm test', 'jest', 'vitest',
  'build', 'pnpm build', 'npm build', 'compile',
  'lint', 'pnpm lint', 'npm lint', 'eslint',
  'install', 'pnpm install', 'npm install',
  'start', 'dev server', 'run server',
];

// Browser/validation intent patterns
const BROWSER_KEYWORDS = [
  'check in browser', 'open in browser', 'screenshot', 'browser screenshot',
  'validate ui', 'validate layout', 'visual check', 'verify render',
  'preview', 'open page', 'view page', 'localhost',
];

// Image intent detection patterns (case-insensitive)
const IMAGE_KEYWORDS = [
  'image', 'photo', 'picture', 'cinematic', 'render', 'rendering',
  'high-resolution', 'high resolution', 'hi-res', 'hires', '4k', '8k',
  'generate an image', 'create an image', 'make an image',
  'visual', 'visualize', 'illustration', 'artwork', 'art',
  'photograph', 'photography', 'portrait', 'landscape',
  'realistic', 'photorealistic', 'hyperrealistic',
  'hero image', 'logo', 'banner', 'thumbnail',
];

const ASPECT_RATIO_PATTERN = /\b\d+:\d+\b/; // e.g., 16:9, 4:5, 1:1

const VISUAL_DESCRIPTORS = [
  'lighting', 'bokeh', 'depth of field', 'dof', 'motion blur',
  'lens flare', 'golden hour', 'blue hour', 'dramatic lighting',
  'soft focus', 'sharp focus', 'wide angle', 'telephoto',
  'macro', 'close-up', 'aerial', 'drone shot',
  'composition', 'foreground', 'background', 'midground',
  'shadows', 'highlights', 'contrast', 'saturation',
  'color grading', 'film grain', 'vignette',
  'ultra detailed', 'highly detailed', 'intricate details',
];

/**
 * Infer expected outputs from goal text.
 * Used by planner to create multi-step plans.
 */
export function inferExpectedOutputs(goal: string): ExpectedOutput[] {
  const lowerGoal = goal.toLowerCase();
  const outputs: Set<ExpectedOutput> = new Set();

  // Check for code patterns
  if (CODE_KEYWORDS.some(kw => lowerGoal.includes(kw))) {
    outputs.add('code');
    outputs.add('files');
  }

  // Check for image patterns
  const hasImageKeyword = IMAGE_KEYWORDS.some(kw => lowerGoal.includes(kw));
  const hasAspectRatio = ASPECT_RATIO_PATTERN.test(goal);
  const hasVisualDescriptor = VISUAL_DESCRIPTORS.some(d => lowerGoal.includes(d));
  
  if (hasImageKeyword || hasAspectRatio || (hasVisualDescriptor && hasImageKeyword)) {
    outputs.add('image');
  }

  // Check for terminal patterns
  if (TERMINAL_KEYWORDS.some(kw => lowerGoal.includes(kw))) {
    outputs.add('terminal');
  }

  // Check for browser patterns
  if (BROWSER_KEYWORDS.some(kw => lowerGoal.includes(kw))) {
    outputs.add('browser_check');
  }

  // Default to text if no specific patterns found
  if (outputs.size === 0) {
    outputs.add('text');
  }

  return Array.from(outputs);
}

/**
 * Hard-rule intent classification for task routing.
 * Image tasks MUST be routed to IMAGE tool, not LLM.
 * Composite tasks go through full planner.
 */
export function classifyIntent(goal: string): IntentClassification {
  const lowerGoal = goal.toLowerCase();
  const signals: string[] = [];
  let imageScore = 0;
  let codeScore = 0;
  let terminalScore = 0;
  let browserScore = 0;

  // Check for code keywords
  for (const keyword of CODE_KEYWORDS) {
    if (lowerGoal.includes(keyword)) {
      signals.push(`code:${keyword}`);
      codeScore += 2;
    }
  }

  // Check for terminal keywords
  for (const keyword of TERMINAL_KEYWORDS) {
    if (lowerGoal.includes(keyword)) {
      signals.push(`terminal:${keyword}`);
      terminalScore += 2;
    }
  }

  // Check for browser keywords
  for (const keyword of BROWSER_KEYWORDS) {
    if (lowerGoal.includes(keyword)) {
      signals.push(`browser:${keyword}`);
      browserScore += 2;
    }
  }

  // Check for explicit image keywords
  for (const keyword of IMAGE_KEYWORDS) {
    if (lowerGoal.includes(keyword)) {
      signals.push(`image:${keyword}`);
      imageScore += 2;
    }
  }

  // Check for aspect ratios
  if (ASPECT_RATIO_PATTERN.test(goal)) {
    const match = goal.match(ASPECT_RATIO_PATTERN);
    signals.push(`aspect_ratio:${match?.[0]}`);
    imageScore += 3; // Strong signal
  }

  // Check for visual descriptors
  for (const descriptor of VISUAL_DESCRIPTORS) {
    if (lowerGoal.includes(descriptor)) {
      signals.push(`visual:${descriptor}`);
      imageScore += 1;
    }
  }

  // Determine inferred outputs
  const inferredOutputs = inferExpectedOutputs(goal);
  
  // Determine if this is a composite task
  const isComposite = inferredOutputs.length > 1 || 
    (codeScore > 0 && imageScore > 0) ||
    terminalScore > 0 ||
    browserScore > 0;

  // Determine output type based on scores
  // Pure image: only image signals, no code/terminal/browser
  const isPureImage = imageScore >= 2 && codeScore === 0 && terminalScore === 0 && browserScore === 0;
  
  let expectedOutput: ExpectedOutputType;
  let enforcedTool: ToolType | null = null;

  if (isPureImage) {
    expectedOutput = 'IMAGE';
    enforcedTool = 'IMAGE';
  } else if (isComposite) {
    expectedOutput = 'COMPOSITE';
    enforcedTool = null; // No single tool - needs full planning
  } else {
    expectedOutput = 'TEXT';
    enforcedTool = null;
  }

  return {
    expectedOutput,
    enforcedTool,
    confidence: Math.min((imageScore + codeScore + terminalScore + browserScore) / 15, 1),
    signals,
    inferredOutputs,
    isComposite,
  };
}

// LLM output patterns that indicate refusal to generate images
export const LLM_IMAGE_REFUSAL_PATTERNS = [
  /i cannot generate images/i,
  /i can't generate images/i,
  /i am unable to generate images/i,
  /i'm unable to generate images/i,
  /i cannot create images/i,
  /i can't create images/i,
  /i can help describe/i,
  /i can only provide text/i,
  /as a text-based/i,
  /as an AI language model/i,
  /i don't have the ability to generate/i,
  /i cannot produce images/i,
  /instead.* describe/i,
  /here is a description/i,
  /let me describe/i,
];

/**
 * Check if LLM output contains refusal patterns that indicate
 * it incorrectly handled an image generation task.
 */
export function isLLMImageRefusal(output: string): boolean {
  if (typeof output !== 'string') return false;
  return LLM_IMAGE_REFUSAL_PATTERNS.some(pattern => pattern.test(output));
}

// ============================================
// TERMINAL TOOL TYPES
// ============================================

export const TERMINAL_TIMEOUT_MS = 60 * 1000; // 1 minute

// Allowlist of safe terminal commands
export const TERMINAL_ALLOWLIST = [
  'pnpm install',
  'pnpm lint',
  'pnpm test',
  'pnpm build',
  'pnpm dev',
  'npm install',
  'npm lint',
  'npm test',
  'npm build',
  'npm run',
  'node -v',
  'node --version',
  'pnpm -v',
  'pnpm --version',
  'npm -v',
  'npm --version',
  'npx prisma generate',
  'npx prisma migrate',
  'npx prisma db push',
  'git status',
  'git log',
  'git diff',
  'ls',
  'dir',
  'cat',
  'type',
  'echo',
  'pwd',
  'cd',
  'bash',
  'sh',
  'node',
];

// Blocklist of dangerous commands
export const TERMINAL_BLOCKLIST = [
  'rm -rf',
  'rm -r',
  'rmdir',
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
  'curl | bash',
  'wget | sh',
  'chmod 777',
  ':(){:|:&};:',
  'fork bomb',
  '> /dev/sda',
  'sudo',
  'su',
];

export interface TerminalInput {
  command: string;
  cwd?: string;                // Working directory (relative to workspace)
  timeout?: number;            // Timeout in ms (default: TERMINAL_TIMEOUT_MS)
  env?: Record<string, string>; // Additional environment variables
}

export interface TerminalOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  command: string;
  cwd: string;
}

// ============================================
// BROWSER TOOL TYPES
// ============================================

export const BROWSER_TIMEOUT_MS = 30 * 1000; // 30 seconds

export type BrowserAction = 'goto' | 'click' | 'type' | 'screenshot' | 'waitForNetworkIdle' | 'waitForSelector';

export interface BrowserInput {
  url?: string;                // URL to navigate to (required for 'goto')
  action: BrowserAction;       // Action to perform
  selector?: string;           // CSS selector for click/type/waitForSelector
  text?: string;               // Text for 'type' action
  timeout?: number;            // Timeout in ms
  screenshotName?: string;     // Custom name for screenshot file
}

export interface BrowserOutput {
  success: boolean;
  action: BrowserAction;
  url?: string;
  screenshotPath?: string;
  error?: string;
  duration: number;
  metadata?: {
    title?: string;
    viewport?: { width: number; height: number };
    timestamp?: string;
    fileName?: string;
    fileSize?: number;
    url?: string;
  };
}

// ============================================
// VERIFICATION/CRITIC TYPES
// ============================================

export interface VerificationInput {
  goal: string;
  expectedOutputs: ExpectedOutput[];
  stepResults: StepResult[];
  workspacePath: string;
}

export interface VerificationResult {
  passed: boolean;
  confidence: number;
  missingArtifacts: string[];
  failedSteps: string[];
  suggestions: string[];
  canRetry: boolean;
  retrySteps?: string[];
}
