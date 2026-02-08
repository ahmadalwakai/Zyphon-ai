'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Plus,
  Search,
  Filter,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface Task {
  id: string;
  goal: string;
  type: string;
  status: string;
  creditsUsed: number;
  createdAt: string;
  workspace: { name: string };
}

const statusConfig: Record<string, { bg: string; text: string; icon: typeof Loader2 }> = {
  QUEUED: { bg: 'bg-gray-500/20', text: 'text-gray-400', icon: Clock },
  PLANNED: { bg: 'bg-warning/20', text: 'text-warning', icon: Clock },
  RUNNING: { bg: 'bg-primary/20', text: 'text-primary', icon: Loader2 },
  SUCCEEDED: { bg: 'bg-success/20', text: 'text-success', icon: CheckCircle2 },
  FAILED: { bg: 'bg-error/20', text: 'text-error', icon: XCircle },
};

export default function TasksListPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    async function fetchTasks() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: '10',
        });
        if (search) params.set('search', search);
        if (statusFilter) params.set('status', statusFilter);

        const res = await fetch(`/api/user/tasks?${params}`);
        if (res.ok) {
          const data = await res.json();
          setTasks(data.data || []);
          setTotalPages(data.pagination?.totalPages || 1);
        }
      } catch (err) {
        console.error('Failed to fetch tasks:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchTasks();
  }, [page, search, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-gray-400 mt-1">Manage and monitor your AI tasks</p>
        </div>
        <Link
          href="/app/tasks/new"
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark rounded-lg font-medium transition-colors"
        >
          <Plus className="w-5 h-5" />
          New Task
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search tasks..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-primary transition-colors"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="pl-10 pr-8 py-2.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-primary transition-colors appearance-none cursor-pointer"
          >
            <option value="">All Status</option>
            <option value="QUEUED">Queued</option>
            <option value="PLANNED">Planned</option>
            <option value="RUNNING">Running</option>
            <option value="SUCCEEDED">Succeeded</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
      </div>

      {/* Task List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-border rounded-xl">
          <Zap className="w-16 h-16 mx-auto text-gray-600 mb-4" />
          <h3 className="text-lg font-medium mb-2">No tasks found</h3>
          <p className="text-gray-400 mb-6">
            {search || statusFilter
              ? 'Try adjusting your filters'
              : 'Create your first task to get started'}
          </p>
          {!search && !statusFilter && (
            <Link
              href="/app/tasks/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark rounded-lg font-medium transition-colors"
            >
              <Plus className="w-5 h-5" />
              Create Task
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task, index) => {
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
                        <span>{task.workspace.name}</span>
                        <span>·</span>
                        <span>{task.type}</span>
                        <span>·</span>
                        <span>{new Date(task.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>
                        {task.status}
                      </span>
                      <span className="text-sm text-gray-400">
                        {task.creditsUsed} credits
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-2 bg-surface border border-border rounded-lg hover:bg-surface-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="px-4 py-2 text-sm">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-2 bg-surface border border-border rounded-lg hover:bg-surface-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}
