/**
 * Groq LLM Client — streaming API wrapper for Groq.
 * Uses the OpenAI-compatible /chat/completions endpoint.
 */

export type GroqStreamCallback = (event: StreamEvent) => void;

export interface StreamEvent {
  type: 'token' | 'done' | 'error';
  content: string;
  stage?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqChoice {
  delta?: { content?: string };
  finish_reason?: string | null;
}

interface GroqStreamChunk {
  choices?: GroqChoice[];
}

export class GroqClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  }) {
    this.apiKey = options?.apiKey ?? process.env['GROK'] ?? '';
    this.baseUrl = options?.baseUrl ?? process.env['GROQ_BASE_URL'] ?? 'https://api.groq.com/openai/v1';
    this.model = options?.model ?? process.env['GROQ_MODEL'] ?? 'llama-3.3-70b-versatile';

    if (!this.apiKey) {
      throw new Error('GROK is required');
    }
  }

  /**
   * Send a chat completion request with streaming.
   * Returns the full response text and calls onToken for each chunk.
   */
  async chat(
    messages: ChatMessage[],
    onToken?: GroqStreamCallback,
    options?: { temperature?: number; maxTokens?: number; stage?: string }
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 4096,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body from Groq API');
    }

    let fullText = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6)) as GroqStreamChunk;
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              onToken?.({
                type: 'token',
                content,
                stage: options?.stage,
              });
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    onToken?.({
      type: 'done',
      content: fullText,
      stage: options?.stage,
    });

    return fullText;
  }

  /**
   * Non-streaming chat for simpler use cases.
   */
  async chatSync(
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 4096,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  }
}
