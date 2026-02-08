import { ToolResult, LLM_TIMEOUT_MS } from '@zyphon/shared';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'llm-tool' });

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

export interface LLMToolInput {
  prompt: string;
  systemPrompt?: string;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export class LLMTool {
  private baseUrl: string;
  private model: string;
  private timeout: number;
  private useCloudLLM: boolean;
  private openaiApiKey: string;
  private openaiBaseUrl: string;
  private openaiModel: string;

  constructor(
    baseUrl: string = process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434',
    model: string = process.env['OLLAMA_MODEL'] || 'deepseek-coder-v2:16b',
    timeout: number = LLM_TIMEOUT_MS
  ) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.timeout = timeout;
    this.openaiApiKey = process.env['OPENAI_API_KEY'] || '';
    this.openaiBaseUrl = process.env['OPENAI_BASE_URL'] || 'https://api.openai.com/v1';
    this.openaiModel = process.env['OPENAI_MODEL'] || 'gpt-4o-mini';
    this.useCloudLLM = !!this.openaiApiKey;
  }

  async listModels(): Promise<OllamaModel[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, {
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
    try {
      const models = await this.listModels();
      return models.some(m => m.name === this.model || m.name.startsWith(this.model));
    } catch (error) {
      logger.error({ error }, 'Failed to check model availability');
      return false;
    }
  }

  async generate(input: LLMToolInput): Promise<ToolResult> {
    if (this.useCloudLLM) {
      return this.generateCloud(input);
    }
    return this.generateOllama(input);
  }

  private async generateCloud(input: LLMToolInput): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const systemPrompt = input.systemPrompt || this.getDefaultSystemPrompt(input.jsonMode);

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: input.prompt },
      ];

      const body: Record<string, any> = {
        model: this.openaiModel,
        messages,
        temperature: input.temperature ?? 0.1,
        max_tokens: input.maxTokens ?? 4096,
      };

      if (input.jsonMode) {
        body['response_format'] = { type: 'json_object' };
      }

      logger.info({ model: this.openaiModel, promptLength: input.prompt.length }, 'Calling Cloud LLM');

      const response = await fetch(`${this.openaiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`Cloud LLM API error: ${response.status} ${errText}`);
      }

      const data = await response.json() as any;
      const duration = Date.now() - startTime;
      let output = data.choices?.[0]?.message?.content || '';

      logger.info({ duration, model: this.openaiModel }, 'Cloud LLM response received');

      if (input.jsonMode) {
        try {
          output = JSON.parse(output);
        } catch {
          logger.warn('Failed to parse JSON response, returning raw');
        }
      }

      return {
        success: true,
        output,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, duration }, 'Cloud LLM tool failed');

      return {
        success: false,
        output: null,
        error: message,
        duration,
      };
    }
  }

  private async generateOllama(input: LLMToolInput): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const systemPrompt = input.systemPrompt || this.getDefaultSystemPrompt(input.jsonMode);

      const request: OllamaGenerateRequest = {
        model: this.model,
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

      logger.info({ model: this.model, promptLength: input.prompt.length }, 'Calling Ollama');

      const response = await this.callWithRetry(request);
      const duration = Date.now() - startTime;

      logger.info({ duration, evalCount: response.eval_count }, 'Ollama response received');

      let output = response.response;

      // Parse JSON if in JSON mode
      if (input.jsonMode) {
        try {
          output = JSON.parse(response.response);
        } catch {
          logger.warn('Failed to parse JSON response, returning raw');
        }
      }

      return {
        success: true,
        output,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, duration }, 'LLM tool failed');

      return {
        success: false,
        output: null,
        error: message,
        duration,
      };
    }
  }

  private async callWithRetry(request: OllamaGenerateRequest, retries = 2): Promise<OllamaGenerateResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(`${this.baseUrl}/api/generate`, {
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
        logger.warn({ attempt, error: lastError.message }, 'Ollama call failed, retrying');

        if (attempt < retries) {
          await this.sleep(1000 * (attempt + 1));
        }
      }
    }

    throw lastError || new Error('All retries exhausted');
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

export const llmTool = new LLMTool();
