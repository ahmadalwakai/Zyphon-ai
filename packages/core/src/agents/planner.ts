import { 
  AgentPlan, 
  AgentPlanStep, 
  TaskType, 
  ToolType, 
  StepType,
  classifyIntent, 
  IntentClassification,
  inferExpectedOutputs,
  ExpectedOutput,
  ExecutionPlan,
  PlanStep,
  TaskConstraints,
  DEFAULT_CONSTRAINTS,
} from '@zyphon/shared';
import { LLMTool } from '../tools/llm.js';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ name: 'planner-agent' });

const PLANNING_SYSTEM_PROMPT = `You are a task planning agent for a multi-step execution engine. Your job is to analyze a goal and break it down into executable steps.

AVAILABLE STEP TYPES:
- PLAN: Initial analysis or sub-planning
- IMAGE_GEN: Generate images using Stable Diffusion (tool: IMAGE)
- CODE_GEN: Generate code using LLM (tool: LLM)
- FS_WRITE: Write files to filesystem (tool: FS)
- FS_READ: Read files from filesystem (tool: FS)
- TERMINAL_RUN: Run terminal commands like pnpm build/test/lint (tool: TERMINAL)
- BROWSER_CHECK: Open browser, take screenshots (tool: BROWSER)
- VERIFY: Final verification of outputs (tool: LLM)

AVAILABLE TOOLS:
- LLM: For code generation, analysis, text output
- IMAGE: For image generation (Stable Diffusion 3)
- FS: For file read/write operations
- TERMINAL: For pnpm build/test/lint commands
- BROWSER: For opening pages and taking screenshots
- NONE: For steps that don't need external tools

RULES:
1. Each step must have a clear type, tool, and input
2. Include acceptance criteria for important steps
3. Image generation REQUIRES type: IMAGE_GEN with tool: IMAGE
4. Code writing REQUIRES steps: CODE_GEN (tool: LLM) then FS_WRITE (tool: FS)
5. Testing REQUIRES type: TERMINAL_RUN with tool: TERMINAL
6. Browser validation REQUIRES type: BROWSER_CHECK with tool: BROWSER
7. Always end with a VERIFY step to confirm outputs
8. Keep step count under maxSteps constraint

OUTPUT FORMAT (strict JSON only):
{
  "expectedOutputs": ["code", "image", ...],
  "steps": [
    {
      "id": "s1",
      "type": "IMAGE_GEN|CODE_GEN|FS_WRITE|TERMINAL_RUN|BROWSER_CHECK|VERIFY",
      "tool": "LLM|IMAGE|FS|TERMINAL|BROWSER|NONE",
      "input": { ... tool-specific input ... },
      "outputs": { "artifacts": ["filename.ext"], "notes": "..." },
      "acceptance": ["criterion 1", "criterion 2"],
      "on_fail": { "retry": 1 },
      "dependsOn": []
    }
  ]
}

TOOL INPUT FORMATS:
- LLM: { "prompt": "...", "systemPrompt": "..." }
- IMAGE: { "prompt": "...", "width": 1920, "height": 1080 }
- FS: { "operation": "write", "path": "src/file.ts", "content": "$step[s2].output" }
- TERMINAL: { "command": "pnpm build", "cwd": "." }
- BROWSER: { "url": "http://localhost:3000", "action": "screenshot" }`;

interface PlannerInput {
  taskId: string;
  goal: string;
  context?: string;
  type: TaskType;
  constraints?: TaskConstraints;
}

interface LLMPlanOutput {
  expectedOutputs?: string[];
  steps: Array<{
    id: string;
    type: string;
    tool: string;
    input: Record<string, unknown>;
    outputs?: { artifacts?: string[]; notes?: string };
    acceptance?: string[];
    on_fail?: { retry?: number; fallback_step?: string };
    dependsOn?: string[];
  }>;
}

export class PlannerAgent {
  private llm: LLMTool;

  constructor(llm?: LLMTool) {
    this.llm = llm || new LLMTool();
  }

  /**
   * Create execution plan for a task.
   * Handles three routing paths:
   * 1. Pure IMAGE tasks: bypass LLM, create direct image plan
   * 2. COMPOSITE tasks: full LLM planning with multi-step execution
   * 3. TEXT tasks: standard LLM planning
   */
  async createPlan(input: PlannerInput): Promise<ExecutionPlan> {
    logger.info({ taskId: input.taskId, goal: input.goal.substring(0, 100) }, 'Creating execution plan');

    // Merge constraints with defaults
    const constraints: Required<TaskConstraints> = {
      ...DEFAULT_CONSTRAINTS,
      ...input.constraints,
    };

    // Classify intent using hard rules
    const intentClassification = classifyIntent(input.goal);
    const inferredOutputs = inferExpectedOutputs(input.goal);

    logger.info({ 
      taskId: input.taskId, 
      expectedOutput: intentClassification.expectedOutput,
      isComposite: intentClassification.isComposite,
      inferredOutputs,
      confidence: intentClassification.confidence,
      signals: intentClassification.signals.slice(0, 5),
    }, 'Intent classified');

    // ROUTING DECISION
    // Pure IMAGE: bypass LLM planning entirely
    if (intentClassification.expectedOutput === 'IMAGE' && !intentClassification.isComposite) {
      logger.info({ taskId: input.taskId }, 'Pure IMAGE task - bypassing LLM planning');
      return this.createPureImagePlan(input, constraints, intentClassification);
    }

    // COMPOSITE or TEXT: use LLM planning
    return this.createLLMPlan(input, constraints, intentClassification, inferredOutputs);
  }

  /**
   * Create a hard-coded plan for pure image generation tasks.
   * Only used when task is EXCLUSIVELY about image generation.
   */
  private createPureImagePlan(
    input: PlannerInput, 
    constraints: Required<TaskConstraints>,
    intent: IntentClassification
  ): ExecutionPlan {
    const dimensions = this.extractDimensions(input.goal);

    const steps: PlanStep[] = [
      {
        id: 's1',
        type: 'IMAGE_GEN',
        tool: 'IMAGE',
        input: {
          prompt: input.goal,
          width: dimensions.width,
          height: dimensions.height,
        },
        outputs: {
          artifacts: [`image_${Date.now()}.png`],
          notes: 'Generated image from prompt',
        },
        acceptance: ['Image file exists', 'Image has correct dimensions'],
        on_fail: { retry: 1 },
        dependsOn: [],
      },
      {
        id: 's2',
        type: 'VERIFY',
        tool: 'NONE',
        input: {
          check: 'image_artifact_exists',
          expectedArtifacts: ['image'],
        },
        outputs: {
          notes: 'Verification of image artifact',
        },
        acceptance: ['Image artifact exists in outputs/images/'],
        dependsOn: ['s1'],
      },
    ];

    logger.info({ 
      taskId: input.taskId, 
      dimensions,
      stepCount: steps.length,
    }, 'Created pure IMAGE plan');

    return {
      taskId: input.taskId,
      goal: input.goal,
      expectedOutputs: ['image'],
      steps,
      constraints,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Create plan using LLM for composite or text tasks.
   */
  private async createLLMPlan(
    input: PlannerInput,
    constraints: Required<TaskConstraints>,
    intent: IntentClassification,
    inferredOutputs: ExpectedOutput[]
  ): Promise<ExecutionPlan> {
    const prompt = this.buildPlanningPrompt(input, constraints, inferredOutputs);

    const result = await this.llm.generate({
      prompt,
      systemPrompt: PLANNING_SYSTEM_PROMPT,
      jsonMode: true,
      temperature: 0.1,
    });

    if (!result.success) {
      throw new Error(`Planner failed: ${result.error}`);
    }

    const planOutput = result.output as LLMPlanOutput;

    if (!planOutput.steps || !Array.isArray(planOutput.steps)) {
      throw new Error('Invalid plan format: missing steps array');
    }

    // Validate and transform steps
    const steps = this.validateAndTransformSteps(planOutput.steps, intent, constraints);

    // Ensure we have a VERIFY step at the end
    if (!steps.some(s => s.type === 'VERIFY')) {
      steps.push(this.createVerifyStep(steps, inferredOutputs));
    }

    // Merge LLM inferred outputs with our inference
    const expectedOutputs = Array.from(new Set([
      ...inferredOutputs,
      ...(planOutput.expectedOutputs?.filter(o => 
        ['code', 'image', 'text', 'files', 'web_result', 'browser_check', 'terminal'].includes(o)
      ) as ExpectedOutput[] || []),
    ]));

    const plan: ExecutionPlan = {
      taskId: input.taskId,
      goal: input.goal,
      expectedOutputs,
      steps,
      constraints,
      createdAt: new Date().toISOString(),
    };

    logger.info({ 
      taskId: input.taskId, 
      stepCount: steps.length,
      expectedOutputs,
    }, 'Created LLM execution plan');

    return plan;
  }

  /**
   * Build the prompt for LLM planning.
   */
  private buildPlanningPrompt(
    input: PlannerInput,
    constraints: Required<TaskConstraints>,
    inferredOutputs: ExpectedOutput[]
  ): string {
    let prompt = `GOAL: ${input.goal}

INFERRED EXPECTED OUTPUTS: ${inferredOutputs.join(', ')}

CONSTRAINTS:
- Maximum steps: ${constraints.maxSteps}
- Maximum time: ${constraints.maxSeconds} seconds
- Terminal allowed: ${constraints.allowTerminal}
- Browser allowed: ${constraints.allowBrowser}
- Web research allowed: ${constraints.allowWeb}

`;

    if (input.context) {
      prompt += `CONTEXT:\n${input.context}\n\n`;
    }

    // Add specific guidance based on inferred outputs
    prompt += 'REQUIRED STEPS:\n';
    
    if (inferredOutputs.includes('image')) {
      prompt += '- Include IMAGE_GEN step with tool: IMAGE for image generation\n';
    }
    
    if (inferredOutputs.includes('code') || inferredOutputs.includes('files')) {
      prompt += '- Include CODE_GEN step with tool: LLM for code generation\n';
      prompt += '- Include FS_WRITE step with tool: FS to save generated code\n';
    }
    
    if (inferredOutputs.includes('terminal')) {
      prompt += '- Include TERMINAL_RUN step with tool: TERMINAL for build/test/lint\n';
    }
    
    if (inferredOutputs.includes('browser_check')) {
      prompt += '- Include BROWSER_CHECK step with tool: BROWSER for visual validation\n';
    }

    prompt += '- Include VERIFY step at the end to confirm all outputs exist\n';
    prompt += '\nCreate a step-by-step plan to achieve this goal.';

    return prompt;
  }

  /**
   * Validate and transform LLM-generated steps.
   */
  private validateAndTransformSteps(
    rawSteps: LLMPlanOutput['steps'],
    intent: IntentClassification,
    constraints: Required<TaskConstraints>
  ): PlanStep[] {
    const validStepTypes: StepType[] = [
      'PLAN', 'WEB_RESEARCH', 'IMAGE_GEN', 'CODE_GEN', 
      'TERMINAL_RUN', 'BROWSER_CHECK', 'FS_WRITE', 'FS_READ', 'VERIFY'
    ];
    const validTools: ToolType[] = ['LLM', 'IMAGE', 'FILE', 'SHELL', 'TERMINAL', 'BROWSER', 'WEB', 'FS', 'NONE'];

    // Limit steps to maxSteps
    const limitedSteps = rawSteps.slice(0, constraints.maxSteps);

    return limitedSteps.map((step, idx) => {
      // Normalize type
      let type = step.type?.toUpperCase() as StepType;
      if (!validStepTypes.includes(type)) {
        // Infer type from tool or default to CODE_GEN
        if (step.tool === 'IMAGE') type = 'IMAGE_GEN';
        else if (step.tool === 'TERMINAL') type = 'TERMINAL_RUN';
        else if (step.tool === 'BROWSER') type = 'BROWSER_CHECK';
        else if (step.tool === 'FS' || step.tool === 'FILE') {
          const op = (step.input as { operation?: string })?.operation;
          type = op === 'read' ? 'FS_READ' : 'FS_WRITE';
        }
        else type = 'CODE_GEN';
      }

      // Normalize tool
      let tool = step.tool?.toUpperCase() as ToolType;
      if (!validTools.includes(tool)) {
        // Infer tool from type
        if (type === 'IMAGE_GEN') tool = 'IMAGE';
        else if (type === 'TERMINAL_RUN') tool = 'TERMINAL';
        else if (type === 'BROWSER_CHECK') tool = 'BROWSER';
        else if (type === 'FS_WRITE' || type === 'FS_READ') tool = 'FS';
        else if (type === 'VERIFY') tool = 'NONE';
        else tool = 'LLM';
      }

      // CRITICAL: Enforce IMAGE tool for IMAGE_GEN type
      if (type === 'IMAGE_GEN' && tool !== 'IMAGE') {
        logger.warn({ stepId: step.id, tool }, 'Forcing IMAGE tool for IMAGE_GEN step');
        tool = 'IMAGE';
      }

      // Check tool constraints
      if (tool === 'TERMINAL' && !constraints.allowTerminal) {
        logger.warn({ stepId: step.id }, 'Terminal not allowed, skipping step');
        type = 'VERIFY'; // Convert to verify step
        tool = 'NONE';
      }
      if (tool === 'BROWSER' && !constraints.allowBrowser) {
        logger.warn({ stepId: step.id }, 'Browser not allowed, skipping step');
        type = 'VERIFY';
        tool = 'NONE';
      }

      return {
        id: step.id || `s${idx + 1}`,
        type,
        tool,
        input: step.input || {},
        outputs: step.outputs,
        acceptance: step.acceptance,
        on_fail: step.on_fail || { retry: 1 },
        dependsOn: step.dependsOn || (idx > 0 ? [limitedSteps[idx - 1]!.id || `s${idx}`] : []),
      };
    });
  }

  /**
   * Create a VERIFY step for the end of the plan.
   */
  private createVerifyStep(steps: PlanStep[], expectedOutputs: ExpectedOutput[]): PlanStep {
    const lastStep = steps[steps.length - 1];
    return {
      id: `s${steps.length + 1}`,
      type: 'VERIFY',
      tool: 'NONE',
      input: {
        expectedOutputs,
        checkArtifacts: true,
      },
      outputs: {
        notes: 'Final verification of all expected outputs',
      },
      acceptance: expectedOutputs.map(o => `${o} artifact exists`),
      dependsOn: lastStep ? [lastStep.id] : [],
    };
  }

  /**
   * Extract image dimensions from goal text.
   */
  private extractDimensions(goal: string): { width: number; height: number } {
    const aspectRatioMatch = goal.match(/(\d+):(\d+)/);
    
    if (aspectRatioMatch) {
      const w = parseInt(aspectRatioMatch[1]!, 10);
      const h = parseInt(aspectRatioMatch[2]!, 10);
      
      const aspectMappings: Record<string, { width: number; height: number }> = {
        '16:9': { width: 1920, height: 1080 },
        '9:16': { width: 1080, height: 1920 },
        '4:3': { width: 1024, height: 768 },
        '3:4': { width: 768, height: 1024 },
        '1:1': { width: 1024, height: 1024 },
        '4:5': { width: 1080, height: 1350 },
        '5:4': { width: 1350, height: 1080 },
        '21:9': { width: 2560, height: 1080 },
      };

      const key = `${w}:${h}`;
      if (aspectMappings[key]) {
        return aspectMappings[key];
      }

      const maxWidth = 1920;
      const calculatedHeight = Math.round((maxWidth * h) / w);
      return { width: maxWidth, height: calculatedHeight };
    }

    if (goal.toLowerCase().includes('high-resolution') || 
        goal.toLowerCase().includes('hi-res') ||
        goal.toLowerCase().includes('4k')) {
      return { width: 1920, height: 1080 };
    }

    return { width: 1024, height: 1024 };
  }

  /**
   * Convert ExecutionPlan to legacy AgentPlan format for backwards compatibility.
   */
  toLegacyPlan(plan: ExecutionPlan): AgentPlan {
    const steps: AgentPlanStep[] = plan.steps.map((step, idx) => ({
      index: idx,
      name: step.id,
      description: step.outputs?.notes || `${step.type} using ${step.tool}`,
      tool: this.mapToolToLegacy(step.tool),
      input: step.input,
      dependsOn: step.dependsOn?.map(depId => {
        const depIdx = plan.steps.findIndex(s => s.id === depId);
        return depIdx >= 0 ? depIdx : 0;
      }) || [],
    }));

    return {
      taskId: plan.taskId,
      goal: plan.goal,
      steps,
      createdAt: plan.createdAt,
    };
  }

  private mapToolToLegacy(tool: ToolType): ToolType {
    // Map new tools to legacy equivalents where needed
    if (tool === 'FS') return 'FILE';
    if (tool === 'NONE') return 'LLM';
    return tool;
  }
}

export const plannerAgent = new PlannerAgent();
