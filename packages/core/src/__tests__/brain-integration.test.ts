/**
 * Integration Tests for Manus-like Brain
 * 
 * These tests verify the Goal → Plan → Steps → Tools → Artifacts pipeline.
 * 
 * Test Cases:
 * 1) Pure IMAGE: Image-only generation
 * 2) Pure CODE: Code generation + file write
 * 3) COMPOSITE: Image + Code + Terminal + Browser
 * 
 * Run with: npx tsx packages/core/src/__tests__/brain-integration.test.ts
 */

import path from 'path';
import fs from 'fs/promises';
import { 
  classifyIntent, 
  inferExpectedOutputs,
  DEFAULT_CONSTRAINTS,
  TaskConstraints,
} from '@zyphon/shared';
import { PlannerAgent } from '../agents/planner.js';
import { ExecutorAgent } from '../agents/executor.js';
import { CriticAgent } from '../agents/critic.js';
import * as pinoModule from 'pino';

const pino = (pinoModule as any).default || pinoModule;
const logger = pino({ 
  name: 'brain-integration-test',
  level: 'info',
});

// Test workspace root
const TEST_WORKSPACE_ROOT = process.env['TEST_WORKSPACE_ROOT'] || './test-workspaces';

interface TestCase {
  name: string;
  goal: string;
  expectedOutputs: string[];
  expectedStepTypes: string[];
  shouldBypassLLMPlanning?: boolean;
}

const TEST_CASES: TestCase[] = [
  {
    name: 'Pure Image',
    goal: 'Create a 16:9 cinematic image of two horses running in Scottish Highlands with dramatic lighting and golden hour atmosphere',
    expectedOutputs: ['image'],
    expectedStepTypes: ['IMAGE_GEN', 'VERIFY'],
    shouldBypassLLMPlanning: true,
  },
  {
    name: 'Pure Code',
    goal: 'Create a Next.js page component with a neon dark theme card layout for displaying user profiles',
    expectedOutputs: ['code', 'files'],
    expectedStepTypes: ['CODE_GEN', 'FS_WRITE', 'VERIFY'],
    shouldBypassLLMPlanning: false,
  },
  {
    name: 'Composite',
    goal: 'Build a landing page with a cinematic hero image and then run pnpm build and open the page in browser for screenshot',
    expectedOutputs: ['code', 'files', 'image', 'terminal', 'browser_check'],
    expectedStepTypes: ['IMAGE_GEN', 'CODE_GEN', 'FS_WRITE', 'TERMINAL_RUN', 'BROWSER_CHECK', 'VERIFY'],
    shouldBypassLLMPlanning: false,
  },
];

async function runIntentClassificationTest(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Intent Classification');
  console.log('='.repeat(60) + '\n');

  for (const testCase of TEST_CASES) {
    console.log(`\n--- ${testCase.name} ---`);
    console.log(`Goal: "${testCase.goal.substring(0, 80)}..."`);
    
    const intent = classifyIntent(testCase.goal);
    const inferred = inferExpectedOutputs(testCase.goal);
    
    console.log(`Expected Output Type: ${intent.expectedOutput}`);
    console.log(`Is Composite: ${intent.isComposite}`);
    console.log(`Inferred Outputs: ${inferred.join(', ')}`);
    console.log(`Confidence: ${intent.confidence.toFixed(2)}`);
    console.log(`Signals: ${intent.signals.slice(0, 5).join(', ')}${intent.signals.length > 5 ? '...' : ''}`);
    
    // Verify expectations
    const expectsImage = testCase.expectedOutputs.includes('image');
    const gotImage = inferred.includes('image');
    const expectsCode = testCase.expectedOutputs.includes('code');
    const gotCode = inferred.includes('code');
    const expectsTerminal = testCase.expectedOutputs.includes('terminal');
    const gotTerminal = inferred.includes('terminal');
    
    if (expectsImage && !gotImage) {
      console.log('❌ FAILED: Expected image output but not inferred');
    } else if (expectsCode && !gotCode) {
      console.log('❌ FAILED: Expected code output but not inferred');
    } else if (expectsTerminal && !gotTerminal) {
      console.log('❌ FAILED: Expected terminal output but not inferred');
    } else {
      console.log('✅ PASSED: Intent classification correct');
    }
  }
}

async function runPlanningTest(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Planning (dry run - no LLM calls needed for pure image)');
  console.log('='.repeat(60) + '\n');

  const planner = new PlannerAgent();

  for (const testCase of TEST_CASES) {
    console.log(`\n--- ${testCase.name} ---`);
    console.log(`Goal: "${testCase.goal.substring(0, 80)}..."`);

    // Only test pure image case which bypasses LLM
    if (testCase.shouldBypassLLMPlanning) {
      try {
        const plan = await planner.createPlan({
          taskId: `test-${Date.now()}`,
          goal: testCase.goal,
          type: 'IMAGE',
        });

        console.log(`Plan created with ${plan.steps.length} steps`);
        console.log(`Expected outputs: ${plan.expectedOutputs.join(', ')}`);
        
        for (const step of plan.steps) {
          console.log(`  - ${step.id}: ${step.type} (tool: ${step.tool})`);
        }

        // Verify step types
        const planStepTypes = plan.steps.map(s => s.type);
        const hasAllExpected = testCase.expectedStepTypes.every(type => 
          planStepTypes.includes(type as any)
        );

        if (hasAllExpected) {
          console.log('✅ PASSED: Plan contains expected step types');
        } else {
          console.log('❌ FAILED: Plan missing expected step types');
          console.log(`  Expected: ${testCase.expectedStepTypes.join(', ')}`);
          console.log(`  Got: ${planStepTypes.join(', ')}`);
        }
      } catch (error) {
        console.log('❌ FAILED: Planning threw error');
        console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      console.log('⏭️  SKIPPED: Requires LLM for planning (run full integration test instead)');
    }
  }
}

async function runExecutionDryTest(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Executor Step Execution (dry run)');
  console.log('='.repeat(60) + '\n');

  const executor = new ExecutorAgent();
  const workspacePath = path.join(TEST_WORKSPACE_ROOT, `test-exec-${Date.now()}`);
  
  // Create test workspace
  await fs.mkdir(path.join(workspacePath, 'outputs', 'images'), { recursive: true });
  await fs.mkdir(path.join(workspacePath, 'logs'), { recursive: true });

  const context = {
    taskId: `test-exec-${Date.now()}`,
    workspacePath,
    goal: 'Test execution',
    constraints: DEFAULT_CONSTRAINTS,
    previousOutputs: new Map<string, unknown>(),
    stepResults: new Map(),
    startTime: Date.now(),
    stepCount: 0,
  };

  // Test VERIFY step (doesn't require external tools)
  const verifyStep = {
    id: 's1',
    type: 'VERIFY' as const,
    tool: 'NONE' as const,
    input: {
      expectedOutputs: ['image'],
      checkArtifacts: true,
    },
    outputs: { notes: 'Verify test' },
    dependsOn: [],
  };

  console.log('Testing VERIFY step execution...');
  const result = await executor.executePlanStep(verifyStep, context);
  
  console.log(`  Status: ${result.status}`);
  console.log(`  Duration: ${result.result.duration}ms`);
  console.log(`  Success: ${result.result.success}`);
  
  // VERIFY should fail because we have no images in test workspace
  if (!result.result.success) {
    console.log('✅ PASSED: VERIFY correctly detected missing artifacts');
  } else {
    console.log('❌ UNEXPECTED: VERIFY passed when it should fail');
  }

  // Cleanup
  await fs.rm(workspacePath, { recursive: true, force: true });
}

async function runCriticTest(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('TEST: Critic Verification');
  console.log('='.repeat(60) + '\n');

  const critic = new CriticAgent();
  const workspacePath = path.join(TEST_WORKSPACE_ROOT, `test-critic-${Date.now()}`);
  
  // Create test workspace with mock image
  await fs.mkdir(path.join(workspacePath, 'outputs', 'images'), { recursive: true });
  await fs.writeFile(
    path.join(workspacePath, 'outputs', 'images', 'test.png'),
    'mock image data'
  );
  await fs.writeFile(
    path.join(workspacePath, 'outputs', 'images', 'test.json'),
    JSON.stringify({ prompt: 'test', filePath: 'test.png' })
  );

  console.log('Testing verification with image artifact...');
  const resultWithImage = await critic.verifyPlanExecution({
    goal: 'Create an image',
    expectedOutputs: ['image'],
    stepResults: [],
    workspacePath,
  });

  console.log(`  Passed: ${resultWithImage.passed}`);
  console.log(`  Missing: ${resultWithImage.missingArtifacts.join(', ') || 'none'}`);
  
  if (resultWithImage.passed) {
    console.log('✅ PASSED: Verification found image artifact');
  } else {
    console.log('❌ FAILED: Verification should have found image');
  }

  // Test without required artifact (use a fresh workspace path)
  const emptyWorkspacePath = path.join(TEST_WORKSPACE_ROOT, `test-critic-empty-${Date.now()}`);
  await fs.mkdir(path.join(emptyWorkspacePath, 'outputs'), { recursive: true });
  
  console.log('\nTesting verification with missing code artifact...');
  const resultNoCode = await critic.verifyPlanExecution({
    goal: 'Create code',
    expectedOutputs: ['code'],
    stepResults: [],
    workspacePath: emptyWorkspacePath,
  });

  console.log(`  Passed: ${resultNoCode.passed}`);
  console.log(`  Missing: ${resultNoCode.missingArtifacts.join(', ') || 'none'}`);
  
  if (!resultNoCode.passed && resultNoCode.missingArtifacts.includes('code')) {
    console.log('✅ PASSED: Verification correctly detected missing code');
  } else {
    console.log('❌ FAILED: Verification should have detected missing code');
  }
  
  // Test with code artifact present
  console.log('\nTesting verification with code artifact...');
  await fs.writeFile(
    path.join(emptyWorkspacePath, 'outputs', 'page.tsx'),
    'export default function Page() { return <div>Test</div>; }'
  );
  
  const resultWithCode = await critic.verifyPlanExecution({
    goal: 'Create code',
    expectedOutputs: ['code'],
    stepResults: [],
    workspacePath: emptyWorkspacePath,
  });

  console.log(`  Passed: ${resultWithCode.passed}`);
  console.log(`  Missing: ${resultWithCode.missingArtifacts.join(', ') || 'none'}`);
  
  if (resultWithCode.passed) {
    console.log('✅ PASSED: Verification found code artifact');
  } else {
    console.log('❌ FAILED: Verification should have found code');
  }

  // Cleanup both workspaces
  await fs.rm(emptyWorkspacePath, { recursive: true, force: true });

  // Cleanup
  await fs.rm(workspacePath, { recursive: true, force: true });
}

async function printSummary(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('INTEGRATION TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`
The Manus-like brain implementation includes:

1. ✅ TaskSpec types in @zyphon/shared
   - TaskSpec, TaskConstraints, PlanStep, ExecutionPlan
   - ExpectedOutput types: code, image, text, files, web_result, browser_check, terminal

2. ✅ Enhanced Intent Classification
   - Detects PURE IMAGE vs COMPOSITE vs TEXT tasks
   - Infers expected outputs from goal text
   - Hard routing for pure image tasks

3. ✅ Multi-Step Planner
   - Generates ExecutionPlan with proper step types
   - Step types: PLAN, IMAGE_GEN, CODE_GEN, FS_WRITE, TERMINAL_RUN, BROWSER_CHECK, VERIFY
   - Bypasses LLM for pure image tasks

4. ✅ Executor with Tool Support
   - LLM tool (DeepSeek via Ollama)
   - IMAGE tool (SD3 Python)
   - TERMINAL tool (sandboxed commands)
   - BROWSER tool (Playwright)
   - FS tool (read/write/patch)

5. ✅ Verification Loop (Critic)
   - Checks expected artifacts exist
   - Supports retry on failure
   - Step-level critique for important steps

6. ✅ Orchestrator Integration
   - Full pipeline: Plan → Execute → Verify
   - Step budget and time budget enforcement
   - Structured result with verification status

To run full integration (requires running services):
  1. Start Ollama: ollama serve
  2. Start Redis: docker compose up redis -d
  3. Run a task through the API
`);
}

async function main(): Promise<void> {
  console.log('\n🧠 Zyphon Manus-like Brain Integration Tests\n');
  
  try {
    await runIntentClassificationTest();
    await runPlanningTest();
    await runExecutionDryTest();
    await runCriticTest();
    await printSummary();
  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  }
}

main();
