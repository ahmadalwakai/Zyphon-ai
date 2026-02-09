/**
 * UserTaskOrchestrator — runs user tasks (prisma.userTask / userTaskStep / userArtifact).
 *
 * Lives in @zyphon/core so both the worker and (if needed) a debug CLI can
 * import it.  The web app should NEVER import this — it enqueues via BullMQ.
 */

import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { prisma } from '@zyphon/db';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'user-task-runner' });

// ── Config (resolved once at module load) ──────────────────────────────────
const _rawWs = process.env['WORKSPACE_ROOT'] || (process.env['VERCEL'] ? '/tmp/workspaces' : './workspaces');
const WORKSPACE_ROOT = path.isAbsolute(_rawWs) ? _rawWs : path.resolve(process.cwd(), _rawWs);
const OLLAMA_BASE_URL = process.env['OLLAMA_BASE_URL'] || process.env['OLLAMA_URL'] || 'http://localhost:11434';
const OLLAMA_MODEL = process.env['OLLAMA_MODEL'] || 'deepseek-coder-v2:16b';
const SD3_SCRIPT_PATH = process.env['SD3_SCRIPT_PATH'] || '';
const SD3_MODEL_PATH = process.env['SD3_MODEL_PATH'] || '';
const SD3_TIMEOUT_MS = parseInt(process.env['SD3_TIMEOUT_MS'] || '900000', 10);
const LLM_TIMEOUT_MS = parseInt(process.env['LLM_TIMEOUT_MS'] || '300000', 10);
const PYTHON_BIN = process.env['PYTHON_BIN'] || 'python';

// ── Types ──────────────────────────────────────────────────────────────────
interface PlanStep {
  index: number;
  name: string;
  description: string;
  tool: 'LLM' | 'IMAGE' | 'FILE' | 'SHELL';
  input: any;
  dependsOn: number[];
}

interface Plan {
  steps: PlanStep[];
}

interface ArtifactRecord {
  name: string;
  type: string;
  path: string;
  relativePath: string;
  size: number;
}

// ── Class ──────────────────────────────────────────────────────────────────
export class UserTaskOrchestrator {
  private artifacts: ArtifactRecord[] = [];

  // ── LLM call ─────────────────────────────────────────────────────────
  private async callLLM(prompt: string, systemPrompt?: string, jsonMode = false): Promise<any> {
    const body = {
      model: OLLAMA_MODEL,
      prompt,
      system: systemPrompt || 'You are a helpful AI assistant.',
      stream: false,
      format: jsonMode ? 'json' : undefined,
      options: { temperature: 0.1, num_predict: 4096 },
    };

    const url = `${OLLAMA_BASE_URL}/api/generate`;
    logger.info({ url, model: OLLAMA_MODEL, timeout: LLM_TIMEOUT_MS }, 'LLM request');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('abort') || msg.includes('timeout')) {
        throw new Error(`LLM_TIMEOUT: ${OLLAMA_BASE_URL} timed out after ${LLM_TIMEOUT_MS}ms`);
      }
      if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
        throw new Error(`LLM_UNREACHABLE: Cannot connect to Ollama at ${OLLAMA_BASE_URL}. Error: ${msg}`);
      }
      throw new Error(`LLM_CONNECTION_ERROR: ${msg}`);
    }

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.statusText}`);
    }

    const data: any = await response.json();

    if (jsonMode) {
      try { return JSON.parse(data.response); } catch { return data.response; }
    }
    return data.response;
  }

  // ── Main entry point ─────────────────────────────────────────────────
  async runTask(taskId: string, userId: string): Promise<void> {
    logger.info({
      taskId, userId,
      config: {
        OLLAMA_BASE_URL,
        OLLAMA_MODEL,
        WORKSPACE_ROOT,
        SD3_SCRIPT_PATH: SD3_SCRIPT_PATH || '(not set)',
        SD3_MODEL_PATH: SD3_MODEL_PATH ? '***set***' : '(not set)',
        PYTHON_BIN,
        LLM_TIMEOUT_MS,
      },
    }, 'Starting user task');

    this.artifacts = [];

    const task = await prisma.userTask.findUnique({ where: { id: taskId } });
    if (!task) throw new Error('Task not found');

    try {
      // ── Workspace init ───────────────────────────────────────────────
      const workspacePath = path.join(WORKSPACE_ROOT, taskId);
      await fs.mkdir(path.join(workspacePath, 'outputs', 'images'), { recursive: true });
      await fs.mkdir(path.join(workspacePath, 'outputs', 'code'), { recursive: true });
      await fs.mkdir(path.join(workspacePath, 'outputs', 'browser'), { recursive: true });
      await fs.mkdir(path.join(workspacePath, 'logs'), { recursive: true });

      await prisma.userTask.update({
        where: { id: taskId },
        data: { status: 'RUNNING', workspacePath, startedAt: new Date() },
      });

      // ── Phase 1: Planning ────────────────────────────────────────────
      logger.info({ taskId }, 'Phase 1 — Planning');
      const plan = await this.createPlan(task.goal, task.context || '', task.type);

      await fs.writeFile(path.join(workspacePath, 'plan.json'), JSON.stringify(plan, null, 2));
      await prisma.userTask.update({ where: { id: taskId }, data: { status: 'PLANNED' } });

      for (const step of plan.steps) {
        await prisma.userTaskStep.create({
          data: {
            taskId,
            index: step.index,
            name: step.name,
            description: step.description,
            tool: step.tool,
            input: step.input as any,
            status: 'PENDING',
          },
        });
      }

      // ── Phase 2: Execution ───────────────────────────────────────────
      logger.info({ taskId, steps: plan.steps.length }, 'Phase 2 — Execution');
      const outputs = new Map<number, any>();
      let creditsUsed = 1;

      for (const step of plan.steps) {
        const stepRecord = await prisma.userTaskStep.findFirst({
          where: { taskId, index: step.index },
        });
        if (!stepRecord) continue;

        await prisma.userTaskStep.update({
          where: { id: stepRecord.id },
          data: { status: 'RUNNING', startedAt: new Date() },
        });

        try {
          const result = await this.executeStep(step, workspacePath, outputs, taskId, stepRecord.id);
          outputs.set(step.index, result);

          // Merge result into existing output so progress lines survive
          const prev = await prisma.userTaskStep.findUnique({ where: { id: stepRecord.id }, select: { output: true } });
          const merged = { ...((prev?.output as any) || {}), result };
          await prisma.userTaskStep.update({
            where: { id: stepRecord.id },
            data: { status: 'COMPLETED', output: merged as any, completedAt: new Date() },
          });

          if (result.artifacts && Array.isArray(result.artifacts)) {
            for (const art of result.artifacts) {
              await this.registerArtifact(taskId, stepRecord.id, art);
            }
          }

          if (step.tool === 'IMAGE') creditsUsed += 2;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          // Preserve progress lines when writing error
          const prev = await prisma.userTaskStep.findUnique({ where: { id: stepRecord.id }, select: { output: true } });
          const merged = { ...((prev?.output as any) || {}), error: errorMsg };
          await prisma.userTaskStep.update({
            where: { id: stepRecord.id },
            data: { status: 'FAILED', error: errorMsg, output: merged as any, completedAt: new Date() },
          });
          throw error;
        }
      }

      // ── Phase 3: Artifact verification ───────────────────────────────
      const lastOutput = outputs.get(plan.steps.length - 1);
      const hasImageSteps = plan.steps.some(s => s.tool === 'IMAGE');

      if (hasImageSteps || task.type === 'IMAGE') {
        const artifacts = await prisma.userArtifact.findMany({ where: { taskId } });
        const imageArtifacts = artifacts.filter(
          (a: { type: string; name: string }) =>
            a.type.startsWith('image/') || a.name.endsWith('.png') || a.name.endsWith('.jpg'),
        );

        if (imageArtifacts.length === 0) {
          const msg = 'ARTIFACT_VERIFICATION_FAILED: No image artifacts created';
          logger.error({ taskId }, msg);
          await prisma.userTask.update({
            where: { id: taskId },
            data: { status: 'FAILED', error: msg, creditsUsed, completedAt: new Date() },
          });
          return;
        }

        for (const art of imageArtifacts) {
          if (!existsSync(art.path)) {
            const msg = `ARTIFACT_VERIFICATION_FAILED: File missing at ${art.path}`;
            logger.error({ taskId, path: art.path }, msg);
            await prisma.userTask.update({
              where: { id: taskId },
              data: { status: 'FAILED', error: msg, creditsUsed, completedAt: new Date() },
            });
            return;
          }
        }

        logger.info({ taskId, count: imageArtifacts.length }, 'Artifact verification passed');
      }

      // ── Success ──────────────────────────────────────────────────────
      await prisma.userTask.update({
        where: { id: taskId },
        data: { status: 'SUCCEEDED', result: lastOutput as any, creditsUsed, completedAt: new Date() },
      });

      logger.info({ taskId, artifacts: this.artifacts.length, creditsUsed }, 'Task completed');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ taskId, error: errorMsg }, 'Task failed');

      await prisma.userTask.update({
        where: { id: taskId },
        data: { status: 'FAILED', error: errorMsg, completedAt: new Date() },
      });

      throw error;
    }
  }

  // ── Planning ─────────────────────────────────────────────────────────
  private async createPlan(goal: string, context: string, type: string): Promise<Plan> {
    const systemPrompt = `You are a task planning agent. Break down the goal into executable steps.

Each step must use ONE tool: LLM, IMAGE, FILE, or SHELL
- LLM: For text generation, code, analysis
- IMAGE: For image generation (requires "prompt" in input)
- FILE: For file operations (requires "operation", "path", optionally "content")
- SHELL: For running commands

Output JSON only:
{
  "steps": [
    {
      "index": 0,
      "name": "step_name",
      "description": "what this step does",
      "tool": "LLM",
      "input": { "prompt": "..." },
      "dependsOn": []
    }
  ]
}`;

    const prompt = `Goal: ${goal}\n${context ? `Context: ${context}\n` : ''}Task type: ${type}\n\nCreate a plan to accomplish this goal. Be specific and actionable.`;

    const result = await this.callLLM(prompt, systemPrompt, true);
    if (!result.steps || !Array.isArray(result.steps)) {
      return { steps: [{ index: 0, name: 'execute_task', description: goal, tool: 'LLM', input: { prompt: goal }, dependsOn: [] }] };
    }
    return result as Plan;
  }

  // ── Step dispatch ────────────────────────────────────────────────────
  private async executeStep(
    step: PlanStep, workspacePath: string,
    previousOutputs: Map<number, any>, taskId: string, stepId: string,
  ): Promise<any> {
    logger.info({ taskId, stepIndex: step.index, stepName: step.name, tool: step.tool }, 'Executing step');
    switch (step.tool) {
      case 'LLM':   return this.executeLLMStep(step, previousOutputs);
      case 'IMAGE': return this.executeImageStep(step, workspacePath, taskId, stepId);
      case 'FILE':  return this.executeFileStep(step, workspacePath, taskId, stepId);
      case 'SHELL': return { message: 'Shell commands disabled for security' };
      default: throw new Error(`Unknown tool: ${step.tool}`);
    }
  }

  // ── LLM step ─────────────────────────────────────────────────────────
  private async executeLLMStep(step: PlanStep, previousOutputs: Map<number, any>): Promise<any> {
    let prompt = step.input.prompt || step.description;
    for (const [idx, output] of previousOutputs) {
      const ph = `{{step_${idx}}}`;
      if (prompt.includes(ph)) {
        prompt = prompt.replace(ph, typeof output === 'string' ? output : JSON.stringify(output));
      }
    }
    return this.callLLM(prompt);
  }

  // ── IMAGE step ───────────────────────────────────────────────────────
  private async executeImageStep(step: PlanStep, workspacePath: string, taskId: string, stepId: string): Promise<any> {
    const start = Date.now();
    const imagesDir = path.join(workspacePath, 'outputs', 'images');
    await fs.mkdir(imagesDir, { recursive: true });

    const filename = `image_${Date.now()}.png`;
    const outputPath = path.join(imagesDir, filename);
    const relativePath = `outputs/images/${filename}`;
    const prompt = step.input.prompt || step.description;

    if (!SD3_SCRIPT_PATH) throw new Error('SD3_NOT_CONFIGURED: SD3_SCRIPT_PATH not set');
    if (!SD3_MODEL_PATH)  throw new Error('SD3_NOT_CONFIGURED: SD3_MODEL_PATH not set');
    if (!existsSync(SD3_SCRIPT_PATH)) throw new Error(`SD3_SCRIPT_NOT_FOUND: ${SD3_SCRIPT_PATH}`);
    if (!existsSync(SD3_MODEL_PATH))  throw new Error(`SD3_MODEL_NOT_FOUND: ${SD3_MODEL_PATH}`);

    // Let generate.py auto-detect CPU/CUDA and pick safe defaults;
    // only pass explicit overrides from the plan step if they exist.
    const width  = step.input.width  || 0;
    const height = step.input.height || 0;
    const steps  = step.input.steps  || 0;

    logger.info({ prompt: prompt.substring(0, 60), width: width || 'auto', height: height || 'auto', steps: steps || 'auto', timeoutMs: SD3_TIMEOUT_MS }, 'Generating image with SD3');

    await this.runSD3Script({ prompt, outputPath, width, height, steps }, stepId);

    if (!existsSync(outputPath)) throw new Error(`SD3_GENERATION_FAILED: No file at ${outputPath}`);
    const stats = await fs.stat(outputPath);
    if (stats.size === 0) throw new Error(`SD3_GENERATION_FAILED: Empty file at ${outputPath}`);

    const duration = Date.now() - start;
    const metadata = {
      prompt,
      width: width || 'auto',
      height: height || 'auto',
      steps: steps || 'auto',
      generatedAt: new Date().toISOString(),
      duration,
      filePath: outputPath,
      fileSize: stats.size,
    };

    const metadataPath = outputPath.replace(/\.png$/, '.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    logger.info({ outputPath, size: stats.size, duration }, 'Image generated');

    return {
      success: true, output: metadata, duration,
      artifacts: [
        { name: filename, type: 'image/png', path: outputPath, relativePath, size: stats.size },
        { name: filename.replace(/\.png$/, '.json'), type: 'application/json', path: metadataPath, relativePath: `outputs/images/${filename.replace(/\.png$/, '.json')}`, size: JSON.stringify(metadata).length },
      ],
    };
  }

  // ── SD3 python spawn ─────────────────────────────────────────────────
  private runSD3Script(input: { prompt: string; outputPath: string; width: number; height: number; steps: number }, stepId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        SD3_SCRIPT_PATH,
        '--prompt', input.prompt,
        '--output', input.outputPath,
        '--model', SD3_MODEL_PATH,
      ];
      if (input.width)  args.push('--width',  String(input.width));
      if (input.height) args.push('--height', String(input.height));
      if (input.steps)  args.push('--steps',  String(input.steps));

      logger.info({ bin: PYTHON_BIN, script: SD3_SCRIPT_PATH, timeoutMs: SD3_TIMEOUT_MS }, 'Spawning SD3');

      const proc = spawn(PYTHON_BIN, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: SD3_TIMEOUT_MS,
      });

      let stdout = '';
      let stderr = '';
      const progressLines: string[] = [];
      let dirty = false;

      // Flush progress to DB every 5 seconds
      const flushInterval = setInterval(async () => {
        if (!dirty) return;
        dirty = false;
        try {
          await prisma.userTaskStep.update({
            where: { id: stepId },
            data: { output: { progress: progressLines.slice(-50) } as any },
          });
        } catch (_) { /* best-effort */ }
      }, 5_000);

      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => {
        const text = d.toString();
        stderr += text;
        const line = text.trim();
        if (line) { progressLines.push(line); dirty = true; }
        logger.warn({ line }, 'SD3 stderr');
      });

      const cleanup = () => { clearInterval(flushInterval); };

      proc.on('close', async code => {
        cleanup();
        // Final flush
        try {
          await prisma.userTaskStep.update({
            where: { id: stepId },
            data: { output: { progress: progressLines.slice(-50) } as any },
          });
        } catch (_) { /* best-effort */ }
        if (code === 0) return resolve();
        logger.error({ code, stderr, stdout }, 'SD3 failed');
        reject(new Error(`SD3 script failed (exit ${code}): ${stderr || stdout}`));
      });

      proc.on('error', err => {
        cleanup();
        logger.error({ error: err.message }, 'SD3 spawn error');
        reject(new Error(`SD3_SPAWN_ERROR: Failed to spawn '${PYTHON_BIN}': ${err.message}`));
      });
    });
  }

  // ── FILE step ────────────────────────────────────────────────────────
  private async executeFileStep(step: PlanStep, workspacePath: string, taskId: string, stepId: string): Promise<any> {
    const { operation, path: filePath, content } = step.input;
    const fullPath = path.join(workspacePath, 'outputs', filePath);
    const relativePath = `outputs/${filePath}`;

    switch (operation) {
      case 'write': {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content || '');
        const stats = await fs.stat(fullPath);
        const mimeType = this.getMimeType(filePath);
        return {
          written: fullPath, size: stats.size,
          artifacts: [{ name: path.basename(filePath), type: mimeType, path: fullPath, relativePath, size: stats.size }],
        };
      }
      case 'read': {
        try {
          const data = await fs.readFile(fullPath, 'utf-8');
          return { content: data, path: fullPath };
        } catch {
          return { error: 'File not found', path: fullPath };
        }
      }
      default:
        throw new Error(`Unknown file operation: ${operation}`);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  private getMimeType(fp: string): string {
    const m: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.ts': 'text/typescript', '.tsx': 'text/typescript',
      '.js': 'text/javascript', '.jsx': 'text/javascript',
      '.json': 'application/json', '.html': 'text/html', '.css': 'text/css',
      '.md': 'text/markdown', '.txt': 'text/plain',
      '.py': 'text/x-python', '.sh': 'text/x-shellscript',
    };
    return m[path.extname(fp).toLowerCase()] || 'application/octet-stream';
  }

  private async registerArtifact(
    taskId: string, stepId: string,
    artifact: { name: string; type: string; path: string; relativePath?: string; size: number },
  ): Promise<void> {
    if (!existsSync(artifact.path)) throw new Error(`Artifact not found: ${artifact.path}`);
    const stats = await fs.stat(artifact.path);
    if (stats.size === 0) throw new Error(`Artifact empty: ${artifact.path}`);

    await prisma.userArtifact.create({
      data: {
        taskId, stepId,
        name: artifact.name, type: artifact.type,
        path: artifact.path, size: stats.size,
        metadata: { relativePath: artifact.relativePath || path.basename(artifact.path), createdAt: new Date().toISOString() },
      },
    });

    this.artifacts.push({
      name: artifact.name, type: artifact.type,
      path: artifact.path, relativePath: artifact.relativePath || path.basename(artifact.path),
      size: stats.size,
    });

    logger.info({ name: artifact.name, size: stats.size }, 'Artifact registered');
  }
}
