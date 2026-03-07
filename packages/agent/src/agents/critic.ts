/**
 * Critic Agent — Reads errors, asks LLM to diagnose, and retries fixes.
 * Implements the self-healing loop: error → diagnose → fix → retry.
 */

import type { Sandbox } from '@zyphon/executor';
import type { LLMRouter } from '../llm/router.js';
import type { GroqStreamCallback } from '../llm/groq-client.js';
import { CoderAgent } from './coder.js';

const CRITIC_SYSTEM_PROMPT = `You are an expert code reviewer and debugger. Analyze the error output and provide a concise fix.

RULES:
1. Identify the root cause of the error.
2. Provide clear, actionable fix instructions.
3. If a file needs to be modified, specify which file and what changes.
4. Be specific — don't give vague advice.
5. Return a JSON object with this structure:
{
  "diagnosis": "Brief explanation of the error",
  "fixType": "modify_file" | "run_command" | "skip",
  "targetFile": "path/to/file.ts",
  "fixInstructions": "Specific instructions for the fix",
  "command": "optional command to run after fixing"
}

Return ONLY valid JSON. No markdown, no explanation outside the JSON.`;

export interface CriticDiagnosis {
  diagnosis: string;
  fixType: 'modify_file' | 'run_command' | 'skip';
  targetFile?: string;
  fixInstructions: string;
  command?: string;
}

export class CriticAgent {
  private llm: LLMRouter;
  private coder: CoderAgent;

  constructor(llm: LLMRouter) {
    this.llm = llm;
    this.coder = new CoderAgent(llm);
  }

  /**
   * Diagnose an error and attempt to fix it.
   * Returns true if the fix succeeded.
   */
  async diagnoseAndFix(
    errorOutput: string,
    sandbox: Sandbox,
    onLog?: GroqStreamCallback,
    maxRetries: number = 3
  ): Promise<{ fixed: boolean; attempts: number; lastError?: string }> {
    let attempts = 0;
    let currentError = errorOutput;

    while (attempts < maxRetries) {
      attempts++;

      onLog?.({
        type: 'token',
        content: `\n🔍 Critic analyzing error (attempt ${attempts}/${maxRetries})...\n`,
        stage: 'fixing',
      });

      // Step 1: Diagnose the error
      const diagnosis = await this.diagnose(currentError, sandbox, onLog);

      if (diagnosis.fixType === 'skip') {
        onLog?.({
          type: 'token',
          content: `⏭ Critic says: skip this error — ${diagnosis.diagnosis}\n`,
          stage: 'fixing',
        });
        return { fixed: true, attempts };
      }

      // Step 2: Apply the fix
      if (diagnosis.fixType === 'modify_file' && diagnosis.targetFile) {
        onLog?.({
          type: 'token',
          content: `🔧 Fixing ${diagnosis.targetFile}...\n`,
          stage: 'fixing',
        });

        let originalContent = '';
        try {
          originalContent = sandbox.readFile(diagnosis.targetFile);
        } catch {
          originalContent = '// File not found — creating new';
        }

        await this.coder.fix(
          diagnosis.targetFile,
          originalContent,
          currentError,
          diagnosis.fixInstructions,
          sandbox,
          onLog
        );
      }

      // Step 3: Re-run the command to verify
      if (diagnosis.command) {
        onLog?.({
          type: 'token',
          content: `🔄 Re-running: ${diagnosis.command}\n`,
          stage: 'fixing',
        });

        const result = await sandbox.exec(diagnosis.command);

        if (result.success) {
          onLog?.({
            type: 'done',
            content: `✓ Fix successful on attempt ${attempts}!\n`,
            stage: 'fixing',
          });
          return { fixed: true, attempts };
        }

        // Update error for next iteration
        currentError = result.stderr || result.stdout;

        onLog?.({
          type: 'error',
          content: `✗ Still failing: ${currentError.substring(0, 300)}\n`,
          stage: 'fixing',
        });
      } else {
        // No re-run command, assume fix is applied
        return { fixed: true, attempts };
      }
    }

    return {
      fixed: false,
      attempts,
      lastError: currentError,
    };
  }

  /**
   * Diagnose an error using the LLM.
   */
  private async diagnose(
    errorOutput: string,
    sandbox: Sandbox,
    onLog?: GroqStreamCallback
  ): Promise<CriticDiagnosis> {
    const files = sandbox.listFiles().slice(-10);
    const fileList = files.join('\n');

    const userPrompt = `ERROR OUTPUT:
\`\`\`
${errorOutput.substring(0, 3000)}
\`\`\`

PROJECT FILES:
${fileList}

Diagnose this error and provide a fix.`;

    const response = await this.llm.chat(
      [
        { role: 'system', content: CRITIC_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      onLog,
      { temperature: 0.2, maxTokens: 2048, stage: 'fixing' }
    );

    return this.parseDiagnosis(response);
  }

  /**
   * Parse the LLM diagnosis response.
   */
  private parseDiagnosis(response: string): CriticDiagnosis {
    let jsonStr = response.trim();

    // Remove code block markers
    if (jsonStr.startsWith('```')) {
      const lines = jsonStr.split('\n');
      lines.shift();
      if (lines[lines.length - 1]?.trim() === '```') {
        lines.pop();
      }
      jsonStr = lines.join('\n');
    }

    // Find JSON object
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      jsonStr = jsonStr.substring(start, end + 1);
    }

    try {
      const diagnosis = JSON.parse(jsonStr) as CriticDiagnosis;
      return {
        diagnosis: diagnosis.diagnosis ?? 'Unknown error',
        fixType: diagnosis.fixType ?? 'skip',
        targetFile: diagnosis.targetFile,
        fixInstructions: diagnosis.fixInstructions ?? 'No fix instructions provided',
        command: diagnosis.command,
      };
    } catch {
      // Fallback if LLM response is not valid JSON
      return {
        diagnosis: 'Could not parse critic response',
        fixType: 'skip',
        fixInstructions: response.substring(0, 500),
      };
    }
  }
}
