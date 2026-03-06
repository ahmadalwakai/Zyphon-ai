import { ToolResult, LLM_TIMEOUT_MS } from '@zyphon/shared';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'llm-tool' });

// ─── Type definitions ──────────────────────────────────────────────────────

type LLMProvider = 'groq' | 'ollama';

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  stream?: boolean;
  format?: 'json';
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
  };
}

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

// OpenAI-compatible types for Groq
interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqChatRequest {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: { type: 'json_object' };
}

interface GroqChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMToolInput {
  prompt: string;
  systemPrompt?: string;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

// ─── LLM Tool Class ────────────────────────────────────────────────────────

export class LLMTool {
  private provider: LLMProvider;
  private groqApiKey: string;
  private groqBaseUrl: string;
  private groqModel: string;
  private ollamaBaseUrl: string;
  private ollamaModel: string;
  private timeout: number;

  constructor(
    options?: {
      provider?: LLMProvider;
      groqApiKey?: string;
      groqBaseUrl?: string;
      groqModel?: string;
      ollamaBaseUrl?: string;
      ollamaModel?: string;
      timeout?: number;
    }
  ) {
    this.provider = options?.provider || (process.env['LLM_PROVIDER'] as LLMProvider) || 'groq';
    this.groqApiKey = options?.groqApiKey || process.env['GROK'] || '';
    this.groqBaseUrl = options?.groqBaseUrl || process.env['GROQ_BASE_URL'] || 'https://api.groq.com/openai/v1';
    this.groqModel = options?.groqModel || process.env['GROQ_MODEL'] || 'llama-3.3-70b-versatile';
    this.ollamaBaseUrl = options?.ollamaBaseUrl || process.env['OLLAMA_BASE_URL'] || process.env['OLLAMA_URL'] || 'http://localhost:11434';
    this.ollamaModel = options?.ollamaModel || process.env['OLLAMA_MODEL'] || 'deepseek-coder-v2:16b';
    this.timeout = options?.timeout ?? LLM_TIMEOUT_MS;
  }

  getProvider(): LLMProvider {
    return this.provider;
  }

  getModel(): string {
    return this.provider === 'groq' ? this.groqModel : this.ollamaModel;
  }

  // ─── Ollama methods (legacy) ─────────────────────────────────────────────

  async listModels(): Promise<OllamaModel[]> {
    if (this.provider !== 'ollama') {
      throw new Error('listModels is only supported for Ollama provider');
    }
    const response = await fetch(`${this.ollamaBaseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.statusText}`);
    }

    const data = await response.json() as { models: OllamaModel[] };
    return data.models;
  }

  async isModelAvailable(): Promise<boolean> {
    if (this.provider === 'groq') {
      // For Groq, just check if API key is set
      return !!this.groqApiKey;
    }
    try {
      const models = await this.listModels();
      return models.some(m => m.name === this.ollamaModel || m.name.startsWith(this.ollamaModel));
    } catch (error) {
      logger.error({ error }, 'Failed to check model availability');
      return false;
    }
  }

  // ─── Main generate method ────────────────────────────────────────────────

  async generate(input: LLMToolInput): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      if (this.provider === 'groq') {
        return await this.generateWithGroq(input, startTime);
      } else {
        return await this.generateWithOllama(input, startTime);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, duration, provider: this.provider }, 'LLM tool failed');

      return {
        success: false,
        output: null,
        error: message,
        duration,
      };
    }
  }

  // ─── Groq implementation ─────────────────────────────────────────────────

  private async generateWithGroq(input: LLMToolInput, startTime: number): Promise<ToolResult> {
    if (!this.groqApiKey) {
      throw new Error('GROK is not set');
    }

    const systemPrompt = input.systemPrompt || this.getDefaultSystemPrompt(input.jsonMode);

    const messages: GroqMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input.prompt },
    ];

    const request: GroqChatRequest = {
      model: this.groqModel,
      messages,
      temperature: input.temperature ?? 0.1,
      max_tokens: input.maxTokens ?? 4096,
      stream: false,
    };

    // Groq supports response_format for JSON mode on some models
    if (input.jsonMode) {
      request.response_format = { type: 'json_object' };
    }

    logger.info({ model: this.groqModel, promptLength: input.prompt.length, provider: 'groq' }, 'Calling Groq API');

    const response = await this.callGroqWithRetry(request);
    const duration = Date.now() - startTime;

    logger.info({ 
      duration, 
      tokens: response.usage?.total_tokens,
      provider: 'groq' 
    }, 'Groq response received');

    let output: any = response.choices[0]?.message?.content || '';

    // Parse JSON if in JSON mode
    if (input.jsonMode) {
      output = this.extractJSON(output);
    }

    return {
      success: true,
      output,
      duration,
    };
  }

  private async callGroqWithRetry(request: GroqChatRequest, retries = 2): Promise<GroqChatResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(`${this.groqBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.groqApiKey}`,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new Error(`Groq API error: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        return await response.json() as GroqChatResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn({ attempt, error: lastError.message, provider: 'groq' }, 'Groq call failed, retrying');

        if (attempt < retries) {
          await this.sleep(1000 * (attempt + 1));
        }
      }
    }

    throw lastError || new Error('All retries exhausted');
  }

  // ─── Ollama implementation ───────────────────────────────────────────────

  private async generateWithOllama(input: LLMToolInput, startTime: number): Promise<ToolResult> {
    const systemPrompt = input.systemPrompt || this.getDefaultSystemPrompt(input.jsonMode);

    const request: OllamaGenerateRequest = {
      model: this.ollamaModel,
      prompt: input.prompt,
      system: systemPrompt,
      stream: false,
      options: {
        temperature: input.temperature ?? 0.1,
        num_predict: input.maxTokens ?? 4096,
      },
    };

    if (input.jsonMode) {
      request.format = 'json';
    }

    logger.info({ model: this.ollamaModel, promptLength: input.prompt.length, provider: 'ollama' }, 'Calling Ollama');

    const response = await this.callOllamaWithRetry(request);
    const duration = Date.now() - startTime;

    logger.info({ duration, evalCount: response.eval_count, provider: 'ollama' }, 'Ollama response received');

    let output: any = response.response;

    // Parse JSON if in JSON mode
    if (input.jsonMode) {
      output = this.extractJSON(output);
    }

    return {
      success: true,
      output,
      duration,
    };
  }

  private async callOllamaWithRetry(request: OllamaGenerateRequest, retries = 2): Promise<OllamaGenerateResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(`${this.ollamaBaseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        return await response.json() as OllamaGenerateResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn({ attempt, error: lastError.message, provider: 'ollama' }, 'Ollama call failed, retrying');

        if (attempt < retries) {
          await this.sleep(1000 * (attempt + 1));
        }
      }
    }

    throw lastError || new Error('All retries exhausted');
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Extract JSON from response, handling common LLM output patterns.
   * Tries multiple strategies: direct parse, code block extraction, regex.
   */
  private extractJSON(text: string): any {
    // Strategy 1: Direct parse
    try {
      return JSON.parse(text);
    } catch {
      // Continue to other strategies
    }

    // Strategy 2: Extract from markdown code block
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch {
        // Continue
      }
    }

    // Strategy 3: Find JSON object or array in text
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // Continue
      }
    }

    logger.warn({ textPreview: text.substring(0, 200) }, 'Failed to extract JSON from response');
    return text;
  }

  private getDefaultSystemPrompt(jsonMode?: boolean): string {
    const base = `You are a highly capable AI assistant specialized in software development and task automation.
You analyze problems carefully and provide precise, actionable solutions.
You follow instructions exactly and never add unnecessary information.`;

    if (jsonMode) {
      return `${base}

IMPORTANT: You MUST respond with valid JSON only. No markdown, no explanations, no text outside the JSON structure.
Your response must be parseable by JSON.parse().`;
    }

    return base;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ─── Singleton instance ────────────────────────────────────────────────────

export const llmTool = new LLMTool();
