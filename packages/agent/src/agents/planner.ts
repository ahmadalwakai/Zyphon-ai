/**
 * Planner Agent — Takes user goal and produces a structured plan.
 * Returns a JSON array of steps for the other agents to execute.
 */

import type { GroqClient, GroqStreamCallback } from '../llm/groq-client.js';

export interface PlanStep {
  step: number;
  type: 'file' | 'command' | 'config' | 'dependency' | 'test';
  description: string;
  filePath?: string;
  command?: string;
}

const PLANNER_SYSTEM_PROMPT = `You are an expert software architect and planner. Given a user's project goal, create a detailed step-by-step plan to build it.

RULES:
1. Each step must be one of these types:
   - "file": Create/write a file (include filePath)
   - "command": Run a shell command (include command)
   - "config": Create a configuration file (include filePath)
   - "dependency": Install dependencies (include command)
   - "test": Run tests or validation (include command)

2. Steps should be in execution order — dependencies first, then config, then source files, then test.

3. Always include:
   - A package.json or equivalent config file
   - Dependency installation step
   - All necessary source files
   - A README.md

4. Keep the project structure clean and professional.

5. Respond with ONLY a valid JSON array of steps. No markdown, no explanation.

Example response:
[
  {"step": 1, "type": "config", "description": "Create package.json with project metadata", "filePath": "package.json"},
  {"step": 2, "type": "dependency", "description": "Install dependencies", "command": "npm install"},
  {"step": 3, "type": "file", "description": "Create main entry point", "filePath": "src/index.ts"},
  {"step": 4, "type": "test", "description": "Run build to verify", "command": "npx tsc --noEmit"}
]`;

export class PlannerAgent {
  private llm: GroqClient;

  constructor(llm: GroqClient) {
    this.llm = llm;
  }

  /**
   * Generate a plan from a user goal.
   */
  async plan(goal: string, onToken?: GroqStreamCallback): Promise<PlanStep[]> {
    const response = await this.llm.chat(
      [
        { role: 'system', content: PLANNER_SYSTEM_PROMPT },
        { role: 'user', content: `Create a detailed build plan for: ${goal}` },
      ],
      onToken,
      { temperature: 0.2, maxTokens: 4096, stage: 'planning' }
    );

    return this.parseSteps(response);
  }

  /**
   * Parse the LLM response into typed PlanStep array.
   */
  private parseSteps(response: string): PlanStep[] {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response.trim();

    // Remove markdown code block markers if present
    if (jsonStr.startsWith('```')) {
      const lines = jsonStr.split('\n');
      lines.shift(); // Remove opening ```json or ```
      if (lines[lines.length - 1]?.trim() === '```') {
        lines.pop(); // Remove closing ```
      }
      jsonStr = lines.join('\n');
    }

    // Find the JSON array
    const startIdx = jsonStr.indexOf('[');
    const endIdx = jsonStr.lastIndexOf(']');
    if (startIdx === -1 || endIdx === -1) {
      throw new Error('Planner did not return a valid JSON array');
    }

    jsonStr = jsonStr.substring(startIdx, endIdx + 1);

    try {
      const steps = JSON.parse(jsonStr) as PlanStep[];

      if (!Array.isArray(steps) || steps.length === 0) {
        throw new Error('Planner returned empty or non-array response');
      }

      // Validate and normalize each step  
      return steps.map((s, i) => ({
        step: s.step ?? i + 1,
        type: s.type ?? 'file',
        description: s.description ?? `Step ${i + 1}`,
        filePath: s.filePath,
        command: s.command,
      }));
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`Planner returned invalid JSON: ${e.message}`);
      }
      throw e;
    }
  }
}
