/**
 * Types shared across agents.
 */

import type { Sandbox } from '@zyphon/executor';
import type { GroqClient, GroqStreamCallback } from './llm/groq-client.js';
import type { PlanStep } from './agents/planner.js';

export interface AgentContext {
  /** Unique task identifier */
  taskId: string;
  /** The user's original goal */
  goal: string;
  /** The sandbox for file/command operations */
  sandbox: Sandbox;
  /** The LLM client */
  llm: GroqClient;
  /** Callback for streaming logs to the client */
  onLog: GroqStreamCallback;
  /** The plan steps (populated after planning) */
  steps: PlanStep[];
  /** Current step index */
  currentStepIndex: number;
  /** Maximum retries per step */
  maxRetries: number;
  /** Whether the task has been aborted */
  aborted: boolean;
}
