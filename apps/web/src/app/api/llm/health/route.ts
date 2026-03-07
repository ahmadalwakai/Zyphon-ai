import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/llm/health
 *
 * Returns the availability and latency of the local Ollama model
 * and the Groq cloud fallback, plus which provider is currently active.
 */
export async function GET() {
  const ollamaUrl =
    process.env['LOCAL_MODEL_URL'] ??
    process.env['OLLAMA_BASE_URL'] ??
    'http://localhost:11434';

  const ollamaModel =
    process.env['LOCAL_MODEL_NAME'] ??
    process.env['OLLAMA_MODEL'] ??
    'qwen2.5-coder:7b-instruct-q4_K_M';

  const groqModel = process.env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile';
  const groqConfigured = !!process.env['GROK'];

  // ── Probe Ollama ──────────────────────────────────────────
  let localAvailable = false;
  let localLatencyMs: number | undefined;

  try {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);

    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    localLatencyMs = Date.now() - start;
    localAvailable = res.ok;
  } catch {
    localAvailable = false;
  }

  // ── Build response ────────────────────────────────────────
  const payload = {
    local: {
      available: localAvailable,
      model: ollamaModel,
      ...(localLatencyMs !== undefined && { latencyMs: localLatencyMs }),
    },
    groq: {
      available: groqConfigured,
      model: groqModel,
    },
    active: (localAvailable ? 'local' : 'groq') as 'local' | 'groq',
  };

  return NextResponse.json(payload);
}
