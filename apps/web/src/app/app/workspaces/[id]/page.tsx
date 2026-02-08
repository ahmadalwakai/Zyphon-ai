'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Plus,
  FolderKanban,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Edit3,
  Trash2,
} from 'lucide-react';

interface Task {
  id: string;
  goal: string;
  type: string;
  status: string;
  createdAt: string;
}

interface Workspace {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  tasks: Task[];
}

const statusConfig: Record<string, { bg: string; text: string; icon: typeof Loader2 }> = {
  QUEUED: { bg: 'bg-gray-500/20', text: 'text-gray-400', icon: Clock },
  PLANNED: { bg: 'bg-warning/20', text: 'text-warning', icon: Clock },
  RUNNING: { bg: 'bg-primary/20', text: 'text-primary', icon: Loader2 },
  SUCCEEDED: { bg: 'bg-success/20', text: 'text-success', icon: CheckCircle2 },
  FAILED: { bg: 'bg-error/20', text: 'text-error', icon: XCircle },
};

export default function WorkspaceDetailPage() {
  const params = useParams();
  const workspaceId = params.id as string;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchWorkspace() {
      try {
        const res = await fetch(`/api/user/workspaces/${workspaceId}`);
        if (!res.ok) {
          throw new Error('Workspace not found');
        }
        const data = await res.json();
        setWorkspace(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workspace');
      } finally {
        setLoading(false);
      }
    }
    fetchWorkspace();
  }, [workspaceId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="text-center py-16">
        <XCircle className="w-16 h-16 mx-auto text-error mb-4" />
        <h2 className="text-xl font-bold mb-2">Error</h2>
        <p className="text-gray-400 mb-6">{error || 'Workspace not found'}</p>
        <Link
          href="/app/workspaces"
          className="inline-flex items-center gap-2 text-primary hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Workspaces
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/app/workspaces"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Workspaces
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-primary/20 flex items-center justify-center">
              <FolderKanban className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{workspace.name}</h1>
              {workspace.description && (
                <p className="text-gray-400 mt-1">{workspace.description}</p>
              )}
            </div>
          </div>
        </div>
        <Link
          href={`/app/tasks/new?workspace=${workspaceId}`}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark rounded-lg font-medium transition-colors"
        >
          <Plus className="w-5 h-5" />
          New Task
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Tasks', value: workspace.tasks.length, color: 'primary' },
          { label: 'Completed', value: workspace.tasks.filter(t => t.status === 'SUCCEEDED').length, color: 'success' },
          { label: 'Running', value: workspace.tasks.filter(t => t.status === 'RUNNING').length, color: 'warning' },
          { label: 'Failed', value: workspace.tasks.filter(t => t.status === 'FAILED').length, color: 'error' },
        ].map((stat) => (
          <div key={stat.label} className="p-4 bg-surface border border-border rounded-xl">
            <p className="text-sm text-gray-400">{stat.label}</p>
            <p className="text-2xl font-bold mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Tasks */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Tasks</h2>
        {workspace.tasks.length === 0 ? (
          <div className="text-center py-16 bg-surface border border-border rounded-xl">
            <Zap className="w-16 h-16 mx-auto text-gray-600 mb-4" />
            <h3 className="text-lg font-medium mb-2">No tasks in this workspace</h3>
            <p className="text-gray-400 mb-6">Create your first task to get started</p>
            <Link
              href={`/app/tasks/new?workspace=${workspaceId}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark rounded-lg font-medium transition-colors"
            >
              <Plus className="w-5 h-5" />
              Create Task
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {workspace.tasks.map((task, index) => {
              const { bg, text, icon: StatusIcon } = statusConfig[task.status] || statusConfig.QUEUED;
              return (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Link
                    href={`/app/tasks/${task.id}`}
                    className="block p-4 bg-surface border border-border rounded-xl hover:border-primary/50 transition-all"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
                        <StatusIcon className={`w-5 h-5 ${text} ${task.status === 'RUNNING' ? 'animate-spin' : ''}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{task.goal}</p>
                        <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                          <span>{task.type}</span>
                          <span>·</span>
                          <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>
                        {task.status}
                      </span>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
