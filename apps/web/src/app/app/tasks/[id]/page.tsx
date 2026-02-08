'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Code2,
  Image as ImageIcon,
  FileText,
  Terminal,
  RefreshCw,
  Download,
  Copy,
  Eye,
  ChevronDown,
  Zap,
} from 'lucide-react';

interface TaskStep {
  id: string;
  index: number;
  name: string;
  description: string;
  tool: string;
  status: string;
  output: any;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface Artifact {
  id: string;
  name: string;
  type: string;
  path: string;
  size: number;
}

interface Task {
  id: string;
  goal: string;
  context: string | null;
  type: string;
  status: string;
  workspacePath: string;
  result: any;
  error: string | null;
  creditsUsed: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  steps: TaskStep[];
  artifacts: Artifact[];
  workspace: { name: string };
}

const toolIcons: Record<string, typeof Code2> = {
  LLM: Code2,
  IMAGE: ImageIcon,
  FILE: FileText,
  SHELL: Terminal,
};

const statusConfig: Record<string, { bg: string; text: string; icon: typeof Loader2 }> = {
  PENDING: { bg: 'bg-gray-500/20', text: 'text-gray-400', icon: Clock },
  RUNNING: { bg: 'bg-primary/20', text: 'text-primary', icon: Loader2 },
  COMPLETED: { bg: 'bg-success/20', text: 'text-success', icon: CheckCircle2 },
  FAILED: { bg: 'bg-error/20', text: 'text-error', icon: XCircle },
  SKIPPED: { bg: 'bg-gray-500/20', text: 'text-gray-400', icon: Clock },
};

function StepCard({ step, isActive }: { step: TaskStep; isActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { bg, text, icon: StatusIcon } = statusConfig[step.status] || statusConfig.PENDING;
  const ToolIcon = toolIcons[step.tool] || Code2;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`border rounded-xl overflow-hidden transition-all ${
        isActive ? 'border-primary shadow-neon' : 'border-border'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center gap-4 text-left hover:bg-surface-light/50 transition-colors"
      >
        <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>
          <StatusIcon className={`w-5 h-5 ${text} ${step.status === 'RUNNING' ? 'animate-spin' : ''}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Step {step.index + 1}</span>
            <div className="flex items-center gap-1 px-2 py-0.5 bg-surface-light rounded text-xs text-gray-400">
              <ToolIcon className="w-3 h-3" />
              {step.tool}
            </div>
          </div>
          <p className="font-medium mt-1 truncate">{step.name}</p>
          <p className="text-sm text-gray-400 truncate">{step.description}</p>
        </div>
        <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border bg-surface-light/30"
          >
            <div className="p-4 space-y-4">
              {step.error && (
                <div className="p-3 bg-error/10 border border-error/30 rounded-lg text-sm text-error">
                  {step.error}
                </div>
              )}
              
              {step.output && (
                <div>
                  <p className="text-xs text-gray-400 mb-2">Output</p>
                  <pre className="p-3 bg-background rounded-lg text-sm overflow-auto max-h-64">
                    {typeof step.output === 'string' 
                      ? step.output 
                      : JSON.stringify(step.output, null, 2)}
                  </pre>
                </div>
              )}

              {step.startedAt && (
                <p className="text-xs text-gray-400">
                  Started: {new Date(step.startedAt).toLocaleTimeString()}
                  {step.completedAt && ` • Completed: ${new Date(step.completedAt).toLocaleTimeString()}`}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ArtifactCard({ artifact, taskId }: { artifact: Artifact; taskId: string }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const isImage = artifact.type.startsWith('image/');
  const artifactUrl = `/api/user/tasks/${taskId}/artifacts/${artifact.id}`;
  
  const handleDownload = () => {
    window.open(`${artifactUrl}?download=true`, '_blank');
  };

  const handlePreview = () => {
    if (isImage) {
      setPreviewOpen(true);
    } else {
      window.open(artifactUrl, '_blank');
    }
  };
  
  return (
    <>
      <div className="p-4 bg-surface border border-border rounded-xl">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
            {isImage ? (
              <ImageIcon className="w-6 h-6 text-primary" />
            ) : (
              <FileText className="w-6 h-6 text-primary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{artifact.name}</p>
            <p className="text-sm text-gray-400">{artifact.type}</p>
            <p className="text-xs text-gray-500">{(artifact.size / 1024).toFixed(1)} KB</p>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handlePreview}
              className="p-2 hover:bg-surface-light rounded-lg transition-colors"
              title="Preview"
            >
              <Eye className="w-4 h-4 text-gray-400 hover:text-primary" />
            </button>
            <button 
              onClick={handleDownload}
              className="p-2 hover:bg-surface-light rounded-lg transition-colors"
              title="Download"
            >
              <Download className="w-4 h-4 text-gray-400 hover:text-primary" />
            </button>
          </div>
        </div>
      </div>

      {/* Image Preview Modal */}
      <AnimatePresence>
        {previewOpen && isImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setPreviewOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="relative max-w-4xl max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={artifactUrl}
                alt={artifact.name}
                className="max-w-full max-h-[90vh] object-contain rounded-lg"
              />
              <button
                onClick={() => setPreviewOpen(false)}
                className="absolute -top-10 right-0 text-white hover:text-gray-300"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const taskId = params.id as string;

  const fetchTask = async () => {
    try {
      const res = await fetch(`/api/user/tasks/${taskId}`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Task not found');
        }
        throw new Error('Failed to fetch task');
      }
      const data = await res.json();
      setTask(data.data);

      // Stop polling if task is complete
      if (['SUCCEEDED', 'FAILED'].includes(data.data.status) && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTask();

    // Poll for updates while task is running
    intervalRef.current = setInterval(fetchTask, 2000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [taskId]);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await fetch(`/api/user/tasks/${taskId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      // Restart polling
      if (!intervalRef.current) {
        intervalRef.current = setInterval(fetchTask, 2000);
      }
      fetchTask();
    } catch (err) {
      console.error('Retry failed:', err);
    } finally {
      setRetrying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <p className="text-gray-400">Loading task...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <XCircle className="w-16 h-16 mx-auto text-error mb-4" />
        <h2 className="text-xl font-bold mb-2">Error</h2>
        <p className="text-gray-400 mb-6">{error}</p>
        <Link
          href="/app/tasks"
          className="inline-flex items-center gap-2 text-primary hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Tasks
        </Link>
      </div>
    );
  }

  if (!task) return null;

  const isRunning = ['QUEUED', 'PLANNED', 'RUNNING'].includes(task.status);
  const currentStepIndex = task.steps.findIndex(s => s.status === 'RUNNING');
  const progress = task.steps.length > 0
    ? (task.steps.filter(s => s.status === 'COMPLETED').length / task.steps.length) * 100
    : 0;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/app/tasks"
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Tasks
        </Link>
        
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
                statusConfig[task.status]?.bg || 'bg-gray-500/20'
              } ${statusConfig[task.status]?.text || 'text-gray-400'}`}>
                {task.status === 'RUNNING' && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                {task.status === 'SUCCEEDED' && <CheckCircle2 className="w-4 h-4" />}
                {task.status === 'FAILED' && <XCircle className="w-4 h-4" />}
                {task.status}
              </span>
              <span className="text-sm text-gray-400">
                {task.workspace.name}
              </span>
            </div>
            <h1 className="text-2xl font-bold">{task.goal}</h1>
            {task.context && (
              <p className="text-gray-400 mt-2">{task.context}</p>
            )}
          </div>

          {task.status === 'FAILED' && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {retrying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Retry
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {isRunning && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Progress</span>
            <span className="text-sm font-medium">{Math.round(progress)}%</span>
          </div>
          <div className="h-2 bg-surface-light rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Steps Timeline */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Execution Steps
          </h2>

          {task.steps.length === 0 ? (
            <div className="p-8 bg-surface border border-border rounded-xl text-center">
              {isRunning ? (
                <>
                  <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
                  <p className="text-gray-400">Planning task...</p>
                </>
              ) : (
                <p className="text-gray-400">No steps recorded</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {task.steps.map((step, index) => (
                <StepCard
                  key={step.id}
                  step={step}
                  isActive={index === currentStepIndex}
                />
              ))}
            </div>
          )}

          {/* Error Display */}
          {task.error && (
            <div className="p-4 bg-error/10 border border-error/30 rounded-xl">
              <p className="text-sm font-medium text-error mb-1">Task Error</p>
              <p className="text-sm text-gray-300">{task.error}</p>
            </div>
          )}

          {/* Result Display */}
          {task.result && task.status === 'SUCCEEDED' && (
            <div className="p-4 bg-success/10 border border-success/30 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-success">Task Result</p>
                <button
                  onClick={() => navigator.clipboard.writeText(
                    typeof task.result === 'string' 
                      ? task.result 
                      : JSON.stringify(task.result, null, 2)
                  )}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  <Copy className="w-3 h-3" />
                  Copy
                </button>
              </div>
              <pre className="p-3 bg-background rounded-lg text-sm overflow-auto max-h-96">
                {typeof task.result === 'string' 
                  ? task.result 
                  : JSON.stringify(task.result, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Task Info */}
          <div className="p-4 bg-surface border border-border rounded-xl space-y-4">
            <h3 className="font-medium">Task Info</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Type</span>
                <span>{task.type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Credits Used</span>
                <span>{task.creditsUsed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Created</span>
                <span>{new Date(task.createdAt).toLocaleDateString()}</span>
              </div>
              {task.startedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Started</span>
                  <span>{new Date(task.startedAt).toLocaleTimeString()}</span>
                </div>
              )}
              {task.completedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Completed</span>
                  <span>{new Date(task.completedAt).toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Artifacts */}
          <div>
            <h3 className="font-medium mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              Artifacts
              {task.artifacts.length > 0 && (
                <span className="px-2 py-0.5 bg-primary/20 text-primary text-xs rounded-full">
                  {task.artifacts.length}
                </span>
              )}
            </h3>

            {/* Error banner for SUCCEEDED task with missing artifacts */}
            {task.status === 'SUCCEEDED' && task.artifacts.length === 0 && task.type === 'IMAGE' && (
              <div className="mb-3 p-4 bg-warning/10 border border-warning/30 rounded-xl">
                <div className="flex items-start gap-3">
                  <XCircle className="w-5 h-5 text-warning mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-warning">Artifacts Missing</p>
                    <p className="text-xs text-gray-400 mt-1">
                      This image task completed but no artifacts were found. The task may have failed to generate the expected output.
                    </p>
                    <button
                      onClick={fetchTask}
                      className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Refresh
                    </button>
                  </div>
                </div>
              </div>
            )}

            {task.artifacts.length === 0 ? (
              <div className="p-4 bg-surface border border-border rounded-xl text-center text-sm text-gray-400">
                {task.status === 'SUCCEEDED' && task.type === 'IMAGE' 
                  ? 'Expected artifacts not found - task may need retry'
                  : 'No artifacts yet'}
              </div>
            ) : (
              <div className="space-y-3">
                {task.artifacts.map((artifact) => (
                  <ArtifactCard key={artifact.id} artifact={artifact} taskId={task.id} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
