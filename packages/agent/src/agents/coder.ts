/**
 * Coder Agent — Takes a plan step and generates code, writing to VirtualFS.
 * Generates contextually-aware code based on the project state.
 */

import type { Sandbox } from '@zyphon/executor';
import type { GroqClient, GroqStreamCallback } from '../llm/groq-client.js';
import type { PlanStep } from './planner.js';

const CODER_SYSTEM_PROMPT = `You are an expert software engineer. Generate production-quality code for the given task.

RULES:
1. Return ONLY the raw file content — no markdown, no code fences, no explanation.
2. Write clean, idiomatic, well-typed TypeScript (or the specified language).
3. Include proper error handling.
4. Follow modern best practices.
5. If the step involves a config file (package.json, tsconfig.json, etc.), return valid JSON/YAML.
6. Do NOT include any commentary or explanations — just the raw file content.
7. Make sure imports are correct and consistent with the project structure.`;

export class CoderAgent {
  private llm: GroqClient;

  constructor(llm: GroqClient) {
    this.llm = llm;
  }

  /**
   * Generate code for a plan step and write it to the sandbox.
   */
  async code(
    step: PlanStep,
    sandbox: Sandbox,
    goal: string,
    allSteps: PlanStep[],
    onToken?: GroqStreamCallback
  ): Promise<{ filePath: string; content: string }> {
    if (!step.filePath) {
      throw new Error(`Step ${step.step} has no filePath — cannot generate code`);
    }

    // Build context from existing files
    const existingFiles = sandbox.listFiles();
    const contextFiles = existingFiles.slice(-10).map((f: string) => {
      try {
        const content = sandbox.readFile(f);
        return `--- ${f} ---\n${content.substring(0, 2000)}`;
      } catch {
        return `--- ${f} --- (could not read)`;
      }
    });

    const planSummary = allSteps.map(s =>
      `${s.step}. [${s.type}] ${s.description}${s.filePath ? ` → ${s.filePath}` : ''}`
    ).join('\n');

    const userPrompt = `PROJECT GOAL: ${goal}

FULL PLAN:
${planSummary}

CURRENT STEP: Step ${step.step} — ${step.description}
FILE TO CREATE: ${step.filePath}

${contextFiles.length > 0 ? `EXISTING PROJECT FILES:\n${contextFiles.join('\n\n')}` : 'This is the first file in the project.'}

Generate the complete content for ${step.filePath}. Return ONLY the raw file content.`;

    const content = await this.llm.chat(
      [
        { role: 'system', content: CODER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      onToken,
      { temperature: 0.2, maxTokens: 8192, stage: 'coding' }
    );

    // Clean up the response — remove any accidental code fences
    const cleaned = this.cleanResponse(content, step.filePath);

    // Write to the sandbox
    sandbox.writeFile(step.filePath, cleaned);

    return { filePath: step.filePath, content: cleaned };
  }

  /**
   * Generate code to fix an error based on critic feedback.
   */
  async fix(
    filePath: string,
    originalContent: string,
    errorOutput: string,
    fixInstructions: string,
    sandbox: Sandbox,
    onToken?: GroqStreamCallback
  ): Promise<{ filePath: string; content: string }> {
    const userPrompt = `The file ${filePath} has an error that needs fixing.

ORIGINAL FILE CONTENT:
\`\`\`
${originalContent}
\`\`\`

ERROR OUTPUT:
\`\`\`
${errorOutput}
\`\`\`

FIX INSTRUCTIONS:
${fixInstructions}

Generate the COMPLETE fixed file content. Return ONLY the raw file content, no explanations.`;

    const content = await this.llm.chat(
      [
        { role: 'system', content: CODER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      onToken,
      { temperature: 0.2, maxTokens: 8192, stage: 'fixing' }
    );

    const cleaned = this.cleanResponse(content, filePath);
    sandbox.writeFile(filePath, cleaned);

    return { filePath, content: cleaned };
  }

  /**
   * Remove accidental markdown code fences from LLM output.
   */
  private cleanResponse(response: string, filePath: string): string {
    let cleaned = response.trim();

    // Remove markdown code block wrapping
    if (cleaned.startsWith('```')) {
      const lines = cleaned.split('\n');
      lines.shift(); // Remove opening ``` or ```typescript etc.
      if (lines.length > 0 && lines[lines.length - 1]?.trim() === '```') {
        lines.pop(); // Remove closing ```
      }
      cleaned = lines.join('\n');
    }

    // For JSON files, validate JSON
    if (filePath.endsWith('.json')) {
      try {
        JSON.parse(cleaned);
      } catch {
        // Try to extract JSON from response
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          cleaned = cleaned.substring(start, end + 1);
        }
      }
    }

    return cleaned;
  }
}
