/**
 * LLM Router — Tries local Ollama first, falls back to Groq API.
 *
 * Priority:
 *   1. Local Ollama (fast, free, private)
 *   2. Groq cloud API (fallback when Ollama is unavailable or times out)
 *
 * On Vercel / production, Ollama won't be reachable so Groq is always used.
 */

import { GroqClient, type GroqStreamCallback } from './groq-client.js';

// ── Types ───────────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RouterConfig {
  /** Ollama base URL (default: http://localhost:11434) */
  ollamaUrl: string;
  /** Ollama model tag (default: qwen2.5-coder:7b-instruct-q4_K_M) */
  ollamaModel: string;
  /** Groq API key (reads GROK env var) */
  groqApiKey: string;
  /** Groq model (default: llama-3.3-70b-versatile) */
  groqModel: string;
  /** Timeout (ms) for the Ollama request before falling back (default: 8000) */
  timeoutMs: number;
}

export interface HealthStatus {
  local: { available: boolean; model: string; latencyMs?: number };
  groq: { available: boolean; model: string };
  active: 'local' | 'groq';
}

// ── Helpers ─────────────────────────────────────────────────

/** fetch() with an AbortController-based timeout. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Router ──────────────────────────────────────────────────

export class LLMRouter {
  private config: RouterConfig;
  private groq: GroqClient;

  /** Cache the last Ollama health probe so we don't probe on every call. */
  private ollamaAvailable: boolean | null = null;
  private lastProbeTime = 0;
  private static readonly PROBE_INTERVAL_MS = 30_000; // re-probe every 30 s

  constructor(options?: Partial<RouterConfig>) {
    this.config = {
      ollamaUrl:
        options?.ollamaUrl ??
        process.env['LOCAL_MODEL_URL'] ??
        process.env['OLLAMA_BASE_URL'] ??
        'http://localhost:11434',
      ollamaModel:
        options?.ollamaModel ??
        process.env['LOCAL_MODEL_NAME'] ??
        process.env['OLLAMA_MODEL'] ??
        'qwen2.5-coder:7b-instruct-q4_K_M',
      groqApiKey: options?.groqApiKey ?? process.env['GROK'] ?? '',
      groqModel:
        options?.groqModel ??
        process.env['GROQ_MODEL'] ??
        'llama-3.3-70b-versatile',
      timeoutMs: options?.timeoutMs ?? 8_000,
    };

    // Build the Groq fallback client (will throw if GROK key is missing)
    this.groq = new GroqClient({
      apiKey: this.config.groqApiKey,
      model: this.config.groqModel,
    });
  }

  // ── Public API (matches GroqClient interface) ─────────────

  /**
   * Streaming chat — tries Ollama, falls back to Groq.
   * Signature mirrors GroqClient.chat() so it's a drop-in replacement.
   */
  async chat(
    messages: ChatMessage[],
    onToken?: GroqStreamCallback,
    options?: { temperature?: number; maxTokens?: number; stage?: string },
  ): Promise<string> {
    // 1. Try Ollama (non-streaming — Ollama streaming SSE format differs)
    if (await this.isOllamaReachable()) {
      try {
        const result = await this.ollamaChat(messages, options);
        console.log(`[LLMRouter] ✓ Using local Ollama (${this.config.ollamaModel})`);

        // Emit the full text as a single "done" token for streaming parity
        onToken?.({ type: 'done', content: result, stage: options?.stage });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[LLMRouter] Ollama request failed, falling back to Groq: ${msg}`);
      }
    }

    // 2. Fallback → Groq
    console.log('[LLMRouter] → Using Groq fallback');
    return this.groq.chat(messages, onToken, options);
  }

  /**
   * Non-streaming chat — mirrors GroqClient.chatSync().
   */
  async chatSync(
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    if (await this.isOllamaReachable()) {
      try {
        const result = await this.ollamaChat(messages, options);
        console.log(`[LLMRouter] ✓ chatSync via local Ollama`);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[LLMRouter] Ollama chatSync failed, falling back to Groq: ${msg}`);
      }
    }

    console.log('[LLMRouter] → chatSync via Groq fallback');
    return this.groq.chatSync(messages, options);
  }

  // ── Health ────────────────────────────────────────────────

  /** Full health probe for the /api/llm/health endpoint. */
  async health(): Promise<HealthStatus> {
    const local = await this.probeOllama();
    const groqAvailable = !!this.config.groqApiKey;

    return {
      local: {
        available: local.available,
        model: this.config.ollamaModel,
        latencyMs: local.latencyMs,
      },
      groq: {
        available: groqAvailable,
        model: this.config.groqModel,
      },
      active: local.available ? 'local' : 'groq',
    };
  }

  // ── Internals ─────────────────────────────────────────────

  /** Quick reachability check with caching. */
  private async isOllamaReachable(): Promise<boolean> {
    const now = Date.now();
    if (
      this.ollamaAvailable !== null &&
      now - this.lastProbeTime < LLMRouter.PROBE_INTERVAL_MS
    ) {
      return this.ollamaAvailable;
    }

    const probe = await this.probeOllama();
    this.ollamaAvailable = probe.available;
    this.lastProbeTime = now;
    return probe.available;
  }

  /** Ping Ollama /api/tags to see if the server is alive. */
  private async probeOllama(): Promise<{ available: boolean; latencyMs?: number }> {
    try {
      const start = Date.now();
      const res = await fetchWithTimeout(
        `${this.config.ollamaUrl}/api/tags`,
        { method: 'GET' },
        3_000, // 3 s probe timeout
      );
      const latencyMs = Date.now() - start;
      return { available: res.ok, latencyMs };
    } catch {
      return { available: false };
    }
  }

  /** Send a chat completion to the local Ollama instance. */
  private async ollamaChat(
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    const body = {
      model: this.config.ollamaModel,
      messages,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.3,
        num_predict: options?.maxTokens ?? 4096,
      },
    };

    const res = await fetchWithTimeout(
      `${this.config.ollamaUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      this.config.timeoutMs,
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama API error (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { message?: { content?: string } };
    const content = data?.message?.content;
    if (!content) {
      throw new Error('Ollama returned empty response');
    }
    return content;
  }
}
