'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Send, 
  Download, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Brain, 
  Code2, 
  Zap, 
  Wrench,
  Package,
  ChevronDown,
  Sparkles
} from 'lucide-react';

// ============================================
// TYPES
// ============================================

interface TaskLog {
  timestamp: number;
  stage: string;
  message: string;
}

interface TaskStatus {
  taskId: string;
  goal: string;
  status: 'queued' | 'planning' | 'coding' | 'executing' | 'fixing' | 'packaging' | 'complete' | 'failed';
  currentStep: number;
  totalSteps: number;
  logs: TaskLog[];
  error?: string;
  downloadUrl?: string;
  fileCount?: number;
  durationMs?: number;
}

type Stage = TaskStatus['status'];

// ============================================
// STAGE CONFIG
// ============================================

const STAGE_CONFIG: Record<Stage, { icon: typeof Brain; label: string; color: string }> = {
  queued: { icon: Loader2, label: 'Queued', color: 'text-gray-400' },
  planning: { icon: Brain, label: 'Planning', color: 'text-blue-400' },
  coding: { icon: Code2, label: 'Coding', color: 'text-purple-400' },
  executing: { icon: Zap, label: 'Executing', color: 'text-yellow-400' },
  fixing: { icon: Wrench, label: 'Fixing', color: 'text-orange-400' },
  packaging: { icon: Package, label: 'Packaging', color: 'text-cyan-400' },
  complete: { icon: CheckCircle2, label: 'Complete', color: 'text-green-400' },
  failed: { icon: XCircle, label: 'Failed', color: 'text-red-400' },
};

const STAGE_ORDER: Stage[] = ['queued', 'planning', 'coding', 'executing', 'fixing', 'packaging', 'complete'];

// ============================================
// MAIN COMPONENT
// ============================================

export default function AgentRunnerPage() {
  const [goal, setGoal] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskStatus | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // ===== SSE CONNECTION =====
  const connectSSE = useCallback((id: string) => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/agent/stream/${id}`);
    eventSourceRef.current = es;

    es.addEventListener('status', (e) => {
      try {
        const data = JSON.parse(e.data) as { status: Stage; currentStep: number; totalSteps: number };
        setTask(prev => prev ? { ...prev, ...data } : null);
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('log', (e) => {
      try {
        const log = JSON.parse(e.data) as TaskLog;
        setTask(prev => {
          if (!prev) return null;
          // Deduplicate logs by timestamp+message
          const exists = prev.logs.some(l => l.timestamp === log.timestamp && l.message === log.message);
          if (exists) return prev;
          return { ...prev, logs: [...prev.logs, log] };
        });
      } catch { /* ignore */ }
    });

    es.addEventListener('done', (e) => {
      try {
        const data = JSON.parse(e.data) as {
          status: Stage;
          downloadUrl?: string;
          fileCount?: number;
          error?: string;
          durationMs?: number;
        };
        setTask(prev => prev ? { ...prev, ...data } : null);
      } catch { /* ignore */ }
      es.close();
    });

    es.addEventListener('timeout', () => {
      es.close();
    });

    es.onerror = () => {
      // SSE connection error — fall back to polling
      es.close();
      pollStatus(id);
    };
  }, []);

  // ===== POLLING FALLBACK =====
  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/agent/status/${id}`);
      if (res.ok) {
        const data = await res.json() as TaskStatus;
        setTask(data);

        if (data.status !== 'complete' && data.status !== 'failed') {
          setTimeout(() => pollStatus(id), 2000);
        }
      }
    } catch { /* ignore polling errors */ }
  }, []);

  // ===== SUBMIT GOAL =====
  const handleSubmit = async () => {
    if (!goal.trim() || isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    setTask(null);
    setTaskId(null);

    try {
      const res = await fetch('/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim() }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as { taskId: string };
      setTaskId(data.taskId);
      setTask({
        taskId: data.taskId,
        goal: goal.trim(),
        status: 'queued',
        currentStep: 0,
        totalSteps: 0,
        logs: [],
      });

      // Connect SSE for live updates
      connectSSE(data.taskId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start task';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ===== AUTO-SCROLL LOGS =====
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [task?.logs.length, autoScroll]);

  // ===== CLEANUP =====
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const isRunning = task && !['complete', 'failed'].includes(task.status);
  const isComplete = task?.status === 'complete';
  const isFailed = task?.status === 'failed';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-xl font-bold">Zyphon Agent</h1>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
              Beta
            </span>
          </div>
          {task && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span>Task: {task.taskId.substring(0, 8)}</span>
              {task.durationMs && (
                <span>• {(task.durationMs / 1000).toFixed(1)}s</span>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Goal Input */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Describe what you want to build
          </label>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder='e.g. "Build a REST API with Express, Prisma, and JWT authentication"'
                className="w-full px-4 py-3 bg-surface border border-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 resize-none transition-all"
                rows={2}
                disabled={isSubmitting || !!isRunning}
                maxLength={2000}
              />
              <span className="absolute bottom-2 right-3 text-xs text-gray-500">
                {goal.length}/2000
              </span>
            </div>
            <button
              onClick={handleSubmit}
              disabled={!goal.trim() || isSubmitting || !!isRunning}
              className="px-6 py-3 bg-primary hover:bg-primary/90 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-xl font-semibold transition-all flex items-center gap-2 h-fit self-end shadow-neon hover:shadow-neon-lg disabled:shadow-none"
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
              Run
            </button>
          </div>
          {error && (
            <p className="mt-2 text-sm text-red-400">{error}</p>
          )}
        </div>

        {/* Task Status */}
        {task && (
          <div className="space-y-6">
            {/* Stage Progress */}
            <div className="bg-surface border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Pipeline Progress</h2>
                {task.totalSteps > 0 && (
                  <span className="text-sm text-gray-400">
                    Step {task.currentStep} / {task.totalSteps}
                  </span>
                )}
              </div>

              {/* Stage Pills */}
              <div className="flex flex-wrap gap-2">
                {STAGE_ORDER.map((stage) => {
                  const config = STAGE_CONFIG[stage];
                  const Icon = config.icon;
                  const stageIdx = STAGE_ORDER.indexOf(stage);
                  const currentIdx = STAGE_ORDER.indexOf(task.status);
                  const isActive = stage === task.status;
                  const isPast = stageIdx < currentIdx || task.status === 'complete';
                  const isFutureStage = stageIdx > currentIdx && task.status !== 'complete';

                  if (stage === 'fixing' && task.status !== 'fixing') return null;

                  return (
                    <div
                      key={stage}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all ${
                        isActive
                          ? `bg-${config.color.replace('text-', '')}/20 border border-current ${config.color}`
                          : isPast
                          ? 'bg-green-400/10 text-green-400 border border-green-400/30'
                          : isFutureStage
                          ? 'bg-gray-800 text-gray-500 border border-gray-700'
                          : ''
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${isActive ? 'animate-pulse' : ''}`} />
                      {config.label}
                    </div>
                  );
                })}
              </div>

              {/* Progress Bar */}
              {isRunning && (
                <div className="mt-4 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(5, (STAGE_ORDER.indexOf(task.status) / (STAGE_ORDER.length - 1)) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Live Logs */}
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-surface-light border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-3 text-sm text-gray-400">Live Output</span>
                </div>
                <button
                  onClick={() => setAutoScroll(prev => !prev)}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
                    autoScroll ? 'text-primary bg-primary/10' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <ChevronDown className={`w-3 h-3 ${autoScroll ? '' : 'rotate-180'}`} />
                  Auto-scroll
                </button>
              </div>

              <div
                ref={logContainerRef}
                className="p-4 max-h-[500px] overflow-y-auto font-mono text-sm leading-relaxed custom-scrollbar"
              >
                {task.logs.length === 0 && (
                  <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Waiting for agent to start...
                  </div>
                )}
                {task.logs.map((log, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-gray-600 shrink-0 select-none">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`shrink-0 w-20 ${getStageColor(log.stage)}`}>
                      [{log.stage}]
                    </span>
                    <span className="text-gray-300 whitespace-pre-wrap break-all">
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Completion / Error Banner */}
            {isComplete && (
              <div className="bg-green-400/10 border border-green-400/30 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-8 h-8 text-green-400" />
                    <div>
                      <h3 className="text-lg font-semibold text-green-400">Project Complete!</h3>
                      <p className="text-sm text-gray-400">
                        {task.fileCount} files generated
                        {task.durationMs && ` in ${(task.durationMs / 1000).toFixed(1)}s`}
                      </p>
                    </div>
                  </div>
                  {task.downloadUrl && (
                    <a
                      href={task.downloadUrl}
                      className="flex items-center gap-2 px-6 py-3 bg-green-500 hover:bg-green-600 rounded-xl font-semibold transition-all shadow-lg"
                    >
                      <Download className="w-5 h-5" />
                      Download ZIP
                    </a>
                  )}
                </div>
              </div>
            )}

            {isFailed && (
              <div className="bg-red-400/10 border border-red-400/30 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <XCircle className="w-8 h-8 text-red-400" />
                    <div>
                      <h3 className="text-lg font-semibold text-red-400">Task Failed</h3>
                      <p className="text-sm text-gray-400">
                        {task.error ?? 'An unknown error occurred'}
                      </p>
                    </div>
                  </div>
                  {task.downloadUrl && (
                    <a
                      href={task.downloadUrl}
                      className="flex items-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-semibold transition-all"
                    >
                      <Download className="w-5 h-5" />
                      Partial Output
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!task && !error && (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-3">Describe your project</h2>
            <p className="text-gray-400 max-w-lg mx-auto mb-8">
              Tell the agent what you want to build. It will plan the project, generate all the code,
              execute commands, fix errors, and package it for download.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-3xl mx-auto">
              {EXAMPLE_GOALS.map((example) => (
                <button
                  key={example}
                  onClick={() => setGoal(example)}
                  className="text-left p-3 bg-surface border border-border rounded-lg text-sm text-gray-400 hover:border-primary/50 hover:text-white transition-all"
                >
                  &ldquo;{example}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ============================================
// HELPERS
// ============================================

function getStageColor(stage: string): string {
  const colors: Record<string, string> = {
    planning: 'text-blue-400',
    coding: 'text-purple-400',
    executing: 'text-yellow-400',
    fixing: 'text-orange-400',
    packaging: 'text-cyan-400',
    error: 'text-red-400',
    system: 'text-green-400',
  };
  return colors[stage] ?? 'text-gray-400';
}

const EXAMPLE_GOALS = [
  'Build a REST API with Express and JWT auth',
  'Create a CLI tool that converts CSV to JSON',
  'Build a React component library with Storybook',
  'Create a Node.js web scraper with Cheerio',
  'Build a TypeScript todo app with SQLite',
  'Create a Markdown to HTML converter',
];
