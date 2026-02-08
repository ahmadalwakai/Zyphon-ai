'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { 
  Zap, 
  FolderKanban, 
  ArrowRight, 
  Clock, 
  CheckCircle2, 
  XCircle,
  Loader2,
  Plus
} from 'lucide-react';
import { useApp } from './layout';

interface TaskSummary {
  id: string;
  goal: string;
  status: string;
  createdAt: string;
  workspace: { name: string };
}

interface WorkspaceSummary {
  id: string;
  name: string;
  _count: { tasks: number };
}

interface Stats {
  totalTasks: number;
  completedTasks: number;
  runningTasks: number;
  totalWorkspaces: number;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; icon: typeof Loader2 }> = {
    QUEUED: { bg: 'bg-gray-500/20', text: 'text-gray-400', icon: Clock },
    PLANNED: { bg: 'bg-warning/20', text: 'text-warning', icon: Clock },
    RUNNING: { bg: 'bg-primary/20', text: 'text-primary', icon: Loader2 },
    SUCCEEDED: { bg: 'bg-success/20', text: 'text-success', icon: CheckCircle2 },
    FAILED: { bg: 'bg-error/20', text: 'text-error', icon: XCircle },
  };
  const { bg, text, icon: Icon } = config[status] || config.QUEUED;
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>
      <Icon className={`w-3.5 h-3.5 ${status === 'RUNNING' ? 'animate-spin' : ''}`} />
      {status}
    </span>
  );
}

export default function AppDashboard() {
  const { user } = useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentTasks, setRecentTasks] = useState<TaskSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [statsRes, tasksRes, wsRes] = await Promise.all([
          fetch('/api/user/stats'),
          fetch('/api/user/tasks?limit=5'),
          fetch('/api/user/workspaces?limit=4'),
        ]);

        if (statsRes.ok) {
          const data = await statsRes.json();
          setStats(data.data);
        }
        if (tasksRes.ok) {
          const data = await tasksRes.json();
          setRecentTasks(data.data || []);
        }
        if (wsRes.ok) {
          const data = await wsRes.json();
          setWorkspaces(data.data || []);
        }
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div>
        <h1 className="text-2xl font-bold">Welcome back, {user?.name?.split(' ')[0] || 'User'}</h1>
        <p className="text-gray-400 mt-1">Here&apos;s what&apos;s happening with your AI tasks</p>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-4">
        <Link
          href="/app/tasks/new"
          className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-dark rounded-xl font-medium transition-colors shadow-neon hover:shadow-neon-lg"
        >
          <Plus className="w-5 h-5" />
          New Task
        </Link>
        <Link
          href="/app/workspaces/new"
          className="flex items-center gap-2 px-6 py-3 bg-surface border border-border hover:border-primary/50 rounded-xl font-medium transition-colors"
        >
          <FolderKanban className="w-5 h-5" />
          Create Workspace
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Tasks', value: stats?.totalTasks || 0, icon: Zap, color: 'primary' },
          { label: 'Completed', value: stats?.completedTasks || 0, icon: CheckCircle2, color: 'success' },
          { label: 'Running', value: stats?.runningTasks || 0, icon: Loader2, color: 'warning' },
          { label: 'Workspaces', value: stats?.totalWorkspaces || 0, icon: FolderKanban, color: 'primary' },
        ].map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="p-6 bg-surface border border-border rounded-xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-400">{stat.label}</p>
                <p className="text-3xl font-bold mt-1">{stat.value}</p>
              </div>
              <div className={`w-10 h-10 rounded-lg bg-${stat.color}/20 flex items-center justify-center`}>
                <stat.icon className={`w-5 h-5 text-${stat.color}`} />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Tasks */}
        <div className="bg-surface border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold">Recent Tasks</h2>
            <Link
              href="/app/tasks"
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View all
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {recentTasks.length === 0 ? (
            <div className="text-center py-8">
              <Zap className="w-12 h-12 mx-auto text-gray-600 mb-3" />
              <p className="text-gray-400">No tasks yet</p>
              <Link
                href="/app/tasks/new"
                className="inline-flex items-center gap-2 mt-4 text-primary hover:underline"
              >
                Create your first task
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentTasks.map((task) => (
                <Link
                  key={task.id}
                  href={`/app/tasks/${task.id}`}
                  className="block p-4 bg-surface-light rounded-lg hover:bg-border/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{task.goal}</p>
                      <p className="text-sm text-gray-400 mt-1">{task.workspace.name}</p>
                    </div>
                    <StatusBadge status={task.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Workspaces */}
        <div className="bg-surface border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold">Workspaces</h2>
            <Link
              href="/app/workspaces"
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View all
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {workspaces.length === 0 ? (
            <div className="text-center py-8">
              <FolderKanban className="w-12 h-12 mx-auto text-gray-600 mb-3" />
              <p className="text-gray-400">No workspaces yet</p>
              <Link
                href="/app/workspaces/new"
                className="inline-flex items-center gap-2 mt-4 text-primary hover:underline"
              >
                Create a workspace
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {workspaces.map((ws) => (
                <Link
                  key={ws.id}
                  href={`/app/workspaces/${ws.id}`}
                  className="p-4 bg-surface-light rounded-lg hover:bg-border/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                      <FolderKanban className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{ws.name}</p>
                      <p className="text-xs text-gray-400">{ws._count.tasks} tasks</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Credits Reminder */}
      {user && user.credits < 20 && (
        <div className="p-4 bg-warning/10 border border-warning/30 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="font-medium">Running low on credits</p>
              <p className="text-sm text-gray-400">You have {user.credits} credits remaining</p>
            </div>
          </div>
          <Link
            href="/app/billing"
            className="px-4 py-2 bg-warning hover:bg-warning/80 text-black rounded-lg font-medium transition-colors"
          >
            Upgrade
          </Link>
        </div>
      )}
    </div>
  );
}
