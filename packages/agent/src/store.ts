/**
 * Task Store — In-memory state management for agent tasks.
 * Maps taskId → current state, logs, and results.
 */

export interface TaskLog {
  timestamp: number;
  stage: 'planning' | 'coding' | 'executing' | 'fixing' | 'packaging' | 'error' | 'system';
  message: string;
}

export interface TaskState {
  taskId: string;
  goal: string;
  status: 'queued' | 'planning' | 'coding' | 'executing' | 'fixing' | 'packaging' | 'complete' | 'failed';
  currentStep: number;
  totalSteps: number;
  logs: TaskLog[];
  error?: string;
  downloadUrl?: string;
  zipPath?: string;
  fileCount?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/**
 * In-memory task store. Replace with Vercel KV or Redis for production.
 */
class TaskStoreImpl {
  private tasks: Map<string, TaskState> = new Map();

  /**
   * Create a new task.
   */
  create(taskId: string, goal: string): TaskState {
    const state: TaskState = {
      taskId,
      goal,
      status: 'queued',
      currentStep: 0,
      totalSteps: 0,
      logs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, state);
    return state;
  }

  /**
   * Get a task by ID.
   */
  get(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Update task state.
   */
  update(taskId: string, updates: Partial<TaskState>): TaskState | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    Object.assign(task, updates, { updatedAt: Date.now() });
    return task;
  }

  /**
   * Add a log entry to a task.
   */
  addLog(taskId: string, stage: TaskLog['stage'], message: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.logs.push({ timestamp: Date.now(), stage, message });
    task.updatedAt = Date.now();
  }

  /**
   * Mark task as completed.
   */
  complete(taskId: string, downloadUrl: string, zipPath: string, fileCount: number): void {
    this.update(taskId, {
      status: 'complete',
      downloadUrl,
      zipPath,
      fileCount,
      completedAt: Date.now(),
    });
  }

  /**
   * Mark task as failed.
   */
  fail(taskId: string, error: string): void {
    this.update(taskId, {
      status: 'failed',
      error,
      completedAt: Date.now(),
    });
  }

  /**
   * List all tasks (for debug/admin).
   */
  list(): TaskState[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Delete old completed/failed tasks to free memory.
   */
  cleanup(maxAgeMs: number = 30 * 60 * 1000): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [id, task] of this.tasks) {
      if (
        (task.status === 'complete' || task.status === 'failed') &&
        now - task.createdAt > maxAgeMs
      ) {
        this.tasks.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }
}

/** Singleton task store instance */
export const TaskStore = new TaskStoreImpl();
