import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { prisma } from '@zyphon/db';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || (process.env.VERCEL ? '/tmp/workspaces' : './workspaces');
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'deepseek-coder-v2:16b';
const SD3_SCRIPT_PATH = process.env.SD3_SCRIPT_PATH || '';
const SD3_MODEL_PATH = process.env.SD3_MODEL_PATH || '';
const SD3_TIMEOUT_MS = 300000; // 5 minutes

// Cloud LLM configuration (used on Vercel where Ollama isn't available)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const USE_CLOUD_LLM = !!OPENAI_API_KEY;

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
  path: string;       // absolute path on disk
  relativePath: string; // workspace-relative path for UI
  size: number;
}

export class UserTaskOrchestrator {
  private artifacts: ArtifactRecord[] = [];

  private async callLLM(prompt: string, systemPrompt?: string, jsonMode = false): Promise<any> {
    if (USE_CLOUD_LLM) {
      return this.callCloudLLM(prompt, systemPrompt, jsonMode);
    }
    return this.callOllamaLLM(prompt, systemPrompt, jsonMode);
  }

  private async callCloudLLM(prompt: string, systemPrompt?: string, jsonMode = false): Promise<any> {
    const messages = [
      { role: 'system' as const, content: systemPrompt || 'You are a helpful AI assistant.' },
      { role: 'user' as const, content: prompt },
    ];

    const body: Record<string, any> = {
      model: OPENAI_MODEL,
      messages,
      temperature: 0.1,
      max_tokens: 4096,
    };

    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`Cloud LLM request failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    if (jsonMode) {
      try {
        return JSON.parse(content);
      } catch {
        return content;
      }
    }

    return content;
  }

  private async callOllamaLLM(prompt: string, systemPrompt?: string, jsonMode = false): Promise<any> {
    const request = {
      model: OLLAMA_MODEL,
      prompt,
      system: systemPrompt || 'You are a helpful AI assistant.',
      stream: false,
      format: jsonMode ? 'json' : undefined,
      options: {
        temperature: 0.1,
        num_predict: 4096,
      },
    };

    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (jsonMode) {
      try {
        return JSON.parse(data.response);
      } catch {
        return data.response;
      }
    }
    
    return data.response;
  }

  async runTask(taskId: string, userId: string): Promise<void> {
    console.log(`[Orchestrator] Starting task ${taskId}`);
    this.artifacts = []; // Reset artifacts for this task

    const task = await prisma.userTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new Error('Task not found');
    }

    try {
      // Initialize workspace - use consistent path: workspaces/{taskId}
      const workspacePath = path.join(WORKSPACE_ROOT, taskId);
      await fs.mkdir(workspacePath, { recursive: true });
      await fs.mkdir(path.join(workspacePath, 'outputs', 'images'), { recursive: true });
      await fs.mkdir(path.join(workspacePath, 'outputs', 'code'), { recursive: true });
      await fs.mkdir(path.join(workspacePath, 'outputs', 'browser'), { recursive: true });
      await fs.mkdir(path.join(workspacePath, 'logs'), { recursive: true });

      // Update workspace path in DB
      await prisma.userTask.update({
        where: { id: taskId },
        data: { 
          status: 'RUNNING',
          workspacePath,
          startedAt: new Date(),
        },
      });

      // Phase 1: Planning
      console.log(`[Orchestrator] Planning task ${taskId}`);
      const plan = await this.createPlan(task.goal, task.context || '', task.type);
      
      // Save plan
      await fs.writeFile(
        path.join(workspacePath, 'plan.json'),
        JSON.stringify(plan, null, 2)
      );

      // Update task status
      await prisma.userTask.update({
        where: { id: taskId },
        data: { status: 'PLANNED' },
      });

      // Create step records
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

      // Phase 2: Execution
      console.log(`[Orchestrator] Executing ${plan.steps.length} steps`);
      const outputs = new Map<number, any>();
      let creditsUsed = 1;

      for (const step of plan.steps) {
        // Update step to running
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

          await prisma.userTaskStep.update({
            where: { id: stepRecord.id },
            data: {
              status: 'COMPLETED',
              output: result as any,
              completedAt: new Date(),
            },
          });

          // Register artifacts created by this step
          if (result.artifacts && Array.isArray(result.artifacts)) {
            for (const artifact of result.artifacts) {
              await this.registerArtifact(taskId, stepRecord.id, artifact);
            }
          }

          // Add credit cost for IMAGE steps
          if (step.tool === 'IMAGE') {
            creditsUsed += 2;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          
          await prisma.userTaskStep.update({
            where: { id: stepRecord.id },
            data: {
              status: 'FAILED',
              error: errorMsg,
              completedAt: new Date(),
            },
          });

          throw error;
        }
      }

      // Phase 3: Artifact verification (NO ARTIFACT, NO SUCCESS)
      const lastOutput = outputs.get(plan.steps.length - 1);
      
      // Check if task requires artifacts
      const hasImageSteps = plan.steps.some(s => s.tool === 'IMAGE');
      const hasBrowserSteps = plan.steps.some(s => s.tool === 'SHELL' && s.input?.command?.includes('screenshot'));
      
      // For IMAGE tasks, verify artifacts exist
      if (hasImageSteps || task.type === 'IMAGE') {
        const artifacts = await prisma.userArtifact.findMany({
          where: { taskId },
        });
        
        // Check for image artifacts
        const imageArtifacts = artifacts.filter((a: { type: string; name: string }) => 
          a.type.startsWith('image/') || a.name.endsWith('.png') || a.name.endsWith('.jpg')
        );
        
        if (imageArtifacts.length === 0) {
          const errorMsg = 'ARTIFACT_VERIFICATION_FAILED: Image task completed but no image artifacts were created. Required: at least 1 PNG file in outputs/images/';
          console.error(`[Orchestrator] ${errorMsg}`);
          
          await prisma.userTask.update({
            where: { id: taskId },
            data: {
              status: 'FAILED',
              error: errorMsg,
              creditsUsed,
              completedAt: new Date(),
            },
          });
          
          return;
        }
        
        // Verify artifacts exist on disk
        for (const artifact of imageArtifacts) {
          if (!existsSync(artifact.path)) {
            const errorMsg = `ARTIFACT_VERIFICATION_FAILED: Artifact ${artifact.name} registered but file not found at ${artifact.path}`;
            console.error(`[Orchestrator] ${errorMsg}`);
            
            await prisma.userTask.update({
              where: { id: taskId },
              data: {
                status: 'FAILED',
                error: errorMsg,
                creditsUsed,
                completedAt: new Date(),
              },
            });
            
            return;
          }
        }
        
        console.log(`[Orchestrator] Artifact verification passed: ${imageArtifacts.length} image(s) verified`);
      }

      // Update task as succeeded
      await prisma.userTask.update({
        where: { id: taskId },
        data: {
          status: 'SUCCEEDED',
          result: lastOutput as any,
          creditsUsed,
          completedAt: new Date(),
        },
      });

      console.log(`[Orchestrator] Task ${taskId} completed successfully with ${this.artifacts.length} artifact(s)`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Orchestrator] Task ${taskId} failed:`, errorMsg);

      await prisma.userTask.update({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          error: errorMsg,
          completedAt: new Date(),
        },
      });

      throw error;
    }
  }

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

    const prompt = `Goal: ${goal}

${context ? `Context: ${context}` : ''}

Task type: ${type}

Create a plan to accomplish this goal. Be specific and actionable.`;

    const result = await this.callLLM(prompt, systemPrompt, true);
    
    if (!result.steps || !Array.isArray(result.steps)) {
      // Fallback to single LLM step
      return {
        steps: [{
          index: 0,
          name: 'execute_task',
          description: goal,
          tool: 'LLM',
          input: { prompt: goal },
          dependsOn: [],
        }],
      };
    }

    return result as Plan;
  }

  private async executeStep(
    step: PlanStep,
    workspacePath: string,
    previousOutputs: Map<number, any>,
    taskId: string,
    stepId: string
  ): Promise<any> {
    console.log(`[Orchestrator] Executing step ${step.index}: ${step.name}`);

    switch (step.tool) {
      case 'LLM':
        return this.executeLLMStep(step, previousOutputs);

      case 'IMAGE':
        return this.executeImageStep(step, workspacePath, taskId, stepId);

      case 'FILE':
        return this.executeFileStep(step, workspacePath, taskId, stepId);

      case 'SHELL':
        return { message: 'Shell commands disabled for security' };

      default:
        throw new Error(`Unknown tool: ${step.tool}`);
    }
  }

  private async executeLLMStep(step: PlanStep, previousOutputs: Map<number, any>): Promise<any> {
    let prompt = step.input.prompt || step.description;

    // Inject previous outputs if referenced
    for (const [idx, output] of previousOutputs) {
      const placeholder = `{{step_${idx}}}`;
      if (prompt.includes(placeholder)) {
        prompt = prompt.replace(
          placeholder,
          typeof output === 'string' ? output : JSON.stringify(output)
        );
      }
    }

    const result = await this.callLLM(prompt);
    return result;
  }

  private async executeImageStep(step: PlanStep, workspacePath: string, taskId: string, stepId: string): Promise<any> {
    const startTime = Date.now();
    const imagesDir = path.join(workspacePath, 'outputs', 'images');
    await fs.mkdir(imagesDir, { recursive: true });
    
    const filename = `image_${Date.now()}.png`;
    const outputPath = path.join(imagesDir, filename);
    const relativePath = `outputs/images/${filename}`;
    const prompt = step.input.prompt || step.description;
    
    // Validate SD3 configuration
    if (!SD3_SCRIPT_PATH) {
      throw new Error('SD3_NOT_CONFIGURED: SD3_SCRIPT_PATH environment variable not set');
    }
    if (!SD3_MODEL_PATH) {
      throw new Error('SD3_NOT_CONFIGURED: SD3_MODEL_PATH environment variable not set');
    }
    
    // Check script exists
    if (!existsSync(SD3_SCRIPT_PATH)) {
      throw new Error(`SD3_SCRIPT_NOT_FOUND: Script not found at ${SD3_SCRIPT_PATH}`);
    }
    
    // Check model exists  
    if (!existsSync(SD3_MODEL_PATH)) {
      throw new Error(`SD3_MODEL_NOT_FOUND: Model not found at ${SD3_MODEL_PATH}`);
    }
    
    console.log(`[Orchestrator] Generating image with SD3: "${prompt.substring(0, 50)}..."`);

    // Run SD3 Python script
    await this.runSD3Script({
      prompt,
      outputPath,
      width: step.input.width || 1024,
      height: step.input.height || 1024,
      steps: step.input.steps || 28,
    });

    // Verify output file exists
    if (!existsSync(outputPath)) {
      throw new Error(`SD3_GENERATION_FAILED: Output file not created at ${outputPath}`);
    }

    // Get file stats
    const stats = await fs.stat(outputPath);
    if (stats.size === 0) {
      throw new Error(`SD3_GENERATION_FAILED: Output file is empty at ${outputPath}`);
    }

    const duration = Date.now() - startTime;
    
    // Save metadata
    const metadata = {
      prompt,
      width: step.input.width || 1024,
      height: step.input.height || 1024,
      steps: step.input.steps || 28,
      generatedAt: new Date().toISOString(),
      duration,
      filePath: outputPath,
      fileSize: stats.size,
    };
    
    const metadataPath = outputPath.replace(/\.png$/, '.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    console.log(`[Orchestrator] Image generated successfully: ${outputPath} (${stats.size} bytes, ${duration}ms)`);

    // Return result with artifacts for registration
    return {
      success: true,
      output: metadata,
      duration,
      artifacts: [
        {
          name: filename,
          type: 'image/png',
          path: outputPath,
          relativePath,
          size: stats.size,
        },
        {
          name: filename.replace(/\.png$/, '.json'),
          type: 'application/json',
          path: metadataPath,
          relativePath: `outputs/images/${filename.replace(/\.png$/, '.json')}`,
          size: JSON.stringify(metadata).length,
        },
      ],
    };
  }

  private runSD3Script(input: {
    prompt: string;
    outputPath: string;
    width: number;
    height: number;
    steps: number;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        SD3_SCRIPT_PATH,
        '--prompt', input.prompt,
        '--output', input.outputPath,
        '--width', String(input.width),
        '--height', String(input.height),
        '--steps', String(input.steps),
        '--model', SD3_MODEL_PATH,
      ];

      console.log(`[Orchestrator] Running: python ${args.join(' ')}`);

      const process = spawn('python', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: SD3_TIMEOUT_MS,
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(`[SD3] ${data.toString().trim()}`);
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
        console.log(`[SD3 ERR] ${data.toString().trim()}`);
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SD3 script failed with code ${code}: ${stderr || stdout}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async executeFileStep(step: PlanStep, workspacePath: string, taskId: string, stepId: string): Promise<any> {
    const { operation, path: filePath, content } = step.input;
    const fullPath = path.join(workspacePath, 'outputs', filePath);
    const relativePath = `outputs/${filePath}`;

    switch (operation) {
      case 'write':
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content || '');
        
        const stats = await fs.stat(fullPath);
        const mimeType = this.getMimeType(filePath);
        
        return { 
          written: fullPath, 
          size: stats.size,
          artifacts: [{
            name: path.basename(filePath),
            type: mimeType,
            path: fullPath,
            relativePath,
            size: stats.size,
          }],
        };

      case 'read':
        try {
          const data = await fs.readFile(fullPath, 'utf-8');
          return { content: data, path: fullPath };
        } catch {
          return { error: 'File not found', path: fullPath };
        }

      default:
        throw new Error(`Unknown file operation: ${operation}`);
    }
  }

  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ts': 'text/typescript',
      '.tsx': 'text/typescript',
      '.js': 'text/javascript',
      '.jsx': 'text/javascript',
      '.json': 'application/json',
      '.html': 'text/html',
      '.css': 'text/css',
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.py': 'text/x-python',
      '.sh': 'text/x-shellscript',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  private async registerArtifact(
    taskId: string,
    stepId: string,
    artifact: { name: string; type: string; path: string; relativePath?: string; size: number }
  ): Promise<void> {
    try {
      // Verify file exists and has content
      if (!existsSync(artifact.path)) {
        console.error(`[Orchestrator] Cannot register artifact: file not found at ${artifact.path}`);
        throw new Error(`Artifact file not found: ${artifact.path}`);
      }

      const stats = await fs.stat(artifact.path);
      if (stats.size === 0) {
        console.error(`[Orchestrator] Cannot register artifact: file is empty at ${artifact.path}`);
        throw new Error(`Artifact file is empty: ${artifact.path}`);
      }

      // Create artifact record in DB
      await prisma.userArtifact.create({
        data: {
          taskId,
          stepId,
          name: artifact.name,
          type: artifact.type,
          path: artifact.path, // Store absolute path for file serving
          size: stats.size,
          metadata: {
            relativePath: artifact.relativePath || path.basename(artifact.path),
            createdAt: new Date().toISOString(),
          },
        },
      });

      this.artifacts.push({
        name: artifact.name,
        type: artifact.type,
        path: artifact.path,
        relativePath: artifact.relativePath || path.basename(artifact.path),
        size: stats.size,
      });

      console.log(`[Orchestrator] Registered artifact: ${artifact.name} (${stats.size} bytes)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Orchestrator] Failed to register artifact: ${message}`);
      throw new Error(`Failed to register artifact ${artifact.name}: ${message}`);
    }
  }
}
