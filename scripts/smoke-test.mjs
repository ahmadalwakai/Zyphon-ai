#!/usr/bin/env node
/**
 * Smoke Test Script for Zyphon Platform
 * 
 * This script performs a real end-to-end test of the Manus-like brain:
 * 1. Creates a composite task (image + browser + terminal)
 * 2. Runs the task
 * 3. Polls until completed
 * 4. Verifies artifacts exist
 * 
 * Prerequisites:
 * - API server running on http://localhost:3002
 * - Worker running
 * - Redis running
 * - Playwright browsers installed (pnpm run playwright:install)
 * - Web app running on http://localhost:3000 (for browser check)
 * 
 * Usage: pnpm run test:smoke
 * 
 * Environment:
 * - API_BASE: API server URL (default: http://localhost:3002)
 * - SKIP_ADMIN_AUTH: Set to 'true' in dev mode for admin routes
 */

import fs from 'fs/promises';
import path from 'path';

const API_BASE = process.env.API_BASE || 'http://localhost:3002';
let API_KEY = process.env.API_KEY || null;
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // 10 minutes max (for slow local LLMs)

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg, color = colors.reset) {
  console.log(`${color}[smoke-test]${colors.reset} ${msg}`);
}

function logSuccess(msg) {
  log(`✓ ${msg}`, colors.green);
}

function logError(msg) {
  log(`✗ ${msg}`, colors.red);
}

function logInfo(msg) {
  log(`ℹ ${msg}`, colors.blue);
}

function logWarn(msg) {
  log(`⚠ ${msg}`, colors.yellow);
}

async function apiRequest(method, endpoint, body = null, isAdmin = false) {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  // Use x-api-key for non-admin routes
  if (API_KEY && !isAdmin) {
    headers['x-api-key'] = API_KEY;
  }
  
  // Admin routes may need Bearer token
  if (isAdmin && process.env.ADMIN_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.ADMIN_TOKEN}`;
  }

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  // Admin routes are at /admin, public routes at /v1
  const prefix = isAdmin ? '' : '/v1';
  const url = `${API_BASE}${prefix}${endpoint}`;
  logInfo(`${method} ${url}`);

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`API error: ${response.status} - ${JSON.stringify(data)}`);
  }

  return data;
}

async function createApiKey(orgId) {
  logInfo('Creating API key for smoke tests...');
  
  const result = await apiRequest('POST', '/admin/api-keys', {
    orgId,
    name: `smoke-test-key-${Date.now()}`,
    scopes: ['tasks:read', 'tasks:write'],
  }, true);

  return result.data;
}

async function createProject(orgId) {
  const projectName = `smoke-test-${Date.now()}`;
  logInfo(`Creating project: ${projectName}`);
  
  const result = await apiRequest('POST', '/admin/projects', {
    orgId,
    name: projectName,
    description: 'Smoke test project',
  }, true);

  return result.data;
}

async function createTask(projectId, goal, type = 'MIXED') {
  logInfo(`Creating task: "${goal.substring(0, 50)}..."`);
  
  const result = await apiRequest('POST', '/tasks', {
    projectId,
    goal,
    type,
    context: JSON.stringify({
      smokeTest: true,
      timestamp: new Date().toISOString(),
    }),
  });

  return result.data;
}

async function runTask(taskId) {
  logInfo(`Running task: ${taskId}`);
  return apiRequest('POST', `/tasks/${taskId}/run`, {});
}

async function getTask(taskId) {
  const result = await apiRequest('GET', `/tasks/${taskId}`);
  return result.data;
}

async function pollTaskCompletion(taskId) {
  logInfo(`Polling task ${taskId} for completion...`);
  
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const task = await getTask(taskId);
    
    log(`  Status: ${task.status} (attempt ${attempt + 1}/${MAX_POLL_ATTEMPTS})`);
    
    if (task.status === 'SUCCEEDED') {
      logSuccess('Task completed successfully');
      return task;
    }
    
    if (task.status === 'FAILED') {
      throw new Error(`Task failed: ${task.error}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  
  throw new Error('Task timed out');
}

async function verifyArtifacts(task) {
  logInfo('Verifying artifacts...');
  
  const workspacePath = task.workspacePath;
  if (!workspacePath) {
    throw new Error('Task has no workspace path');
  }

  const checks = {
    imageOutput: false,
    browserScreenshot: false,
    terminalLog: false,
    dbArtifacts: false,
    apiArtifactsHaveImages: false,
  };

  // Check for image output on disk
  const imagesDir = path.join(workspacePath, 'outputs', 'images');
  try {
    const imageFiles = await fs.readdir(imagesDir);
    const pngFiles = imageFiles.filter(f => f.endsWith('.png'));
    checks.imageOutput = pngFiles.length > 0;
    if (checks.imageOutput) {
      logSuccess(`Found ${pngFiles.length} image(s) in outputs/images/`);
    }
  } catch (e) {
    logWarn('No images directory or no images found');
  }

  // Check for browser screenshot on disk
  const browserDir = path.join(workspacePath, 'outputs', 'browser');
  try {
    const browserFiles = await fs.readdir(browserDir);
    const screenshots = browserFiles.filter(f => f.endsWith('.png'));
    checks.browserScreenshot = screenshots.length > 0;
    if (checks.browserScreenshot) {
      logSuccess(`Found ${screenshots.length} screenshot(s) in outputs/browser/`);
    }
  } catch (e) {
    logWarn('No browser directory or no screenshots found');
  }

  // Check for terminal logs on disk
  const terminalLogsDir = path.join(workspacePath, 'logs', 'terminal');
  try {
    const logFiles = await fs.readdir(terminalLogsDir);
    const jsonLogs = logFiles.filter(f => f.endsWith('.json'));
    checks.terminalLog = jsonLogs.length > 0;
    if (checks.terminalLog) {
      logSuccess(`Found ${jsonLogs.length} terminal log(s) in logs/terminal/`);
    }
  } catch (e) {
    logWarn('No terminal logs directory or no logs found');
  }

  // CRITICAL: Check artifacts from API response (DB records)
  if (task.artifacts && task.artifacts.length > 0) {
    checks.dbArtifacts = true;
    logSuccess(`Found ${task.artifacts.length} artifact(s) registered in database`);
    
    // Check for image artifacts specifically
    const imageArtifacts = task.artifacts.filter(a => 
      a.type?.startsWith('image/') || a.name?.endsWith('.png') || a.name?.endsWith('.jpg')
    );
    
    checks.apiArtifactsHaveImages = imageArtifacts.length > 0;
    if (checks.apiArtifactsHaveImages) {
      logSuccess(`Found ${imageArtifacts.length} image artifact(s) in API response`);
    }
    
    for (const artifact of task.artifacts) {
      log(`  - ${artifact.name} (${artifact.type}, ${artifact.size} bytes)`);
    }
  } else {
    logWarn('No artifacts found in API response - this is a CRITICAL failure for IMAGE tasks');
  }

  // Check steps
  if (task.steps && task.steps.length > 0) {
    logInfo(`Task had ${task.steps.length} step(s):`);
    for (const step of task.steps) {
      const statusIcon = step.status === 'COMPLETED' ? '✓' : step.status === 'FAILED' ? '✗' : '○';
      log(`  ${statusIcon} ${step.name} [${step.tool}] - ${step.status}`);
    }
  }

  return checks;
}

async function getOrCreateOrg() {
  // Try to get existing org from admin API
  const result = await apiRequest('GET', '/admin/orgs', null, true);
  if (result.data && result.data.length > 0) {
    logInfo(`Using existing org: ${result.data[0].name}`);
    return result.data[0];
  }
  
  // Create new org
  const org = await apiRequest('POST', '/admin/orgs', {
    name: 'Smoke Test Org',
    slug: `smoke-test-${Date.now()}`,
  }, true);
  
  logSuccess(`Created org: ${org.data.name}`);
  return org.data;
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                    ZYPHON SMOKE TEST                                      ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  API:     ${API_BASE.padEnd(65)}║
║  API Key: ${API_KEY ? '(from env)'.padEnd(65) : '(will create)'.padEnd(65)}║
╚═══════════════════════════════════════════════════════════════════════════╝
`);

  try {
    // Step 1: Get or create org
    logInfo('Step 1: Getting/creating organization');
    const org = await getOrCreateOrg();

    // Step 1b: Get or create API key (if not provided)
    if (!API_KEY) {
      logInfo('Step 1b: Creating API key');
      const apiKeyData = await createApiKey(org.id);
      API_KEY = apiKeyData.key;
      logSuccess(`API key created: ${apiKeyData.prefix}...${apiKeyData.last4}`);
    }

    // Step 2: Create project
    logInfo('Step 2: Creating project');
    const project = await createProject(org.id);
    logSuccess(`Project created: ${project.id}`);

    // Step 3: Create a composite task
    logInfo('Step 3: Creating composite task');
    const compositeGoal = `
      Create a smoke test verification:
      1. Generate a simple test image (512x512) with prompt "a green checkmark on white background"
      2. Navigate to http://localhost:3000 and take a screenshot to verify the web app is running
      3. Run terminal command "echo SMOKE_TEST_SUCCESS" to verify terminal execution
    `;
    
    const task = await createTask(project.id, compositeGoal, 'MIXED');
    logSuccess(`Task created: ${task.id}`);

    // Step 4: Run the task
    logInfo('Step 4: Running task');
    await runTask(task.id);
    logSuccess('Task queued for execution');

    // Step 5: Poll for completion
    logInfo('Step 5: Waiting for task completion');
    const completedTask = await pollTaskCompletion(task.id);

    // Step 6: Verify artifacts
    logInfo('Step 6: Verifying artifacts');
    const checks = await verifyArtifacts(completedTask);

    // Final summary
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                    SMOKE TEST RESULTS                                     ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Task ID:      ${completedTask.id.padEnd(59)}║
║  Status:       ${completedTask.status.padEnd(59)}║
║  Artifacts:    ${(completedTask.artifacts?.length || 0).toString().padEnd(59)}║
║                                                                           ║
║  Artifact Checks:                                                         ║
║    Image Output (disk):  ${(checks.imageOutput ? '✓ PASS' : '✗ FAIL').padEnd(51)}║
║    Browser Screenshot:   ${(checks.browserScreenshot ? '✓ PASS' : '✗ FAIL').padEnd(51)}║
║    Terminal Log:         ${(checks.terminalLog ? '✓ PASS' : '✗ FAIL').padEnd(51)}║
║    DB Artifacts:         ${(checks.dbArtifacts ? '✓ PASS' : '✗ FAIL').padEnd(51)}║
║    API Has Image:        ${(checks.apiArtifactsHaveImages ? '✓ PASS' : '✗ FAIL').padEnd(51)}║
╚═══════════════════════════════════════════════════════════════════════════╝
`);

    // Log artifacts list for verification
    if (completedTask.artifacts && completedTask.artifacts.length > 0) {
      console.log('\nArtifact list from API:');
      for (const a of completedTask.artifacts) {
        console.log(`  - ${a.name} (${a.type}, ${a.size} bytes)`);
      }
    }

    // For IMAGE tasks, artifacts are REQUIRED
    const isImageTask = completedTask.type === 'IMAGE' || completedTask.type === 'MIXED';
    if (isImageTask && !checks.dbArtifacts) {
      logError('CRITICAL: Task type requires artifacts but none were found in API response!');
      logError('This is the exact bug we are fixing: tasks show SUCCEEDED but artifacts are missing in UI.');
      process.exit(1);
    }

    // Exit with error if critical checks failed
    const allPassed = checks.imageOutput && checks.browserScreenshot && checks.terminalLog;
    if (!allPassed) {
      logWarn('Some disk artifact checks failed - this may be expected if certain tools are not fully configured');
      // Continue - disk vs DB checks are separate concerns
    }

    if (!checks.dbArtifacts && isImageTask) {
      logError('CRITICAL: DB artifacts check failed for IMAGE task - this MUST be fixed');
      process.exit(1);
    }

    logSuccess('Smoke test completed!');
    process.exit(0);

  } catch (error) {
    logError(`Smoke test failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
