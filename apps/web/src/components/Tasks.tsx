'use client';

import useSWR from 'swr';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { Card } from './ui/Card';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface Task {
  id: string;
  externalId: string;
  status: string;
  type: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  projectId: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  project?: { name: string };
}

export function Tasks() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const { data, error, isLoading, mutate } = useSWR<{ data: Task[]; pagination: { total: number } }>(
    `/api/admin/tasks?page=${page}&limit=20${statusFilter ? `&status=${statusFilter}` : ''}`,
    fetcher
  );
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const handleCancel = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this task?')) return;
    const res = await fetch(`/api/admin/tasks/${id}/cancel`, { method: 'POST' });
    if (res.ok) mutate();
  };

  const handleRetry = async (id: string) => {
    const res = await fetch(`/api/admin/tasks/${id}/retry`, { method: 'POST' });
    if (res.ok) mutate();
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    running: 'bg-blue-500/20 text-blue-400',
    completed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
    cancelled: 'bg-gray-500/20 text-gray-400',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <div className="flex gap-4">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="input-neon"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button onClick={() => mutate()} className="btn-neon">
            Refresh
          </button>
        </div>
      </div>

      {isLoading && <p className="text-gray-400">Loading tasks...</p>}
      {error && <p className="text-red-400">Failed to load tasks</p>}

      <div className="grid gap-4">
        {data?.data?.map((task, index) => (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
          >
            <Card 
              className="p-6 cursor-pointer hover:border-blue-500/50 transition-colors"
              onClick={() => setSelectedTask(task)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-white font-mono">{task.externalId}</h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[task.status] || 'bg-gray-500/20 text-gray-400'}`}>
                      {task.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mt-1">
                    Type: {task.type} • Project: {task.project?.name || task.projectId}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-500">
                    {new Date(task.createdAt).toLocaleString()}
                  </span>
                  {task.status === 'pending' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCancel(task.id); }}
                      className="text-red-400 hover:text-red-300 transition-colors text-sm"
                    >
                      Cancel
                    </button>
                  )}
                  {task.status === 'failed' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRetry(task.id); }}
                      className="text-blue-400 hover:text-blue-300 transition-colors text-sm"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
              {task.error && (
                <p className="text-sm text-red-400 mt-2 truncate">{task.error}</p>
              )}
            </Card>
          </motion.div>
        ))}
      </div>

      {data?.pagination && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">
            Total: {data.pagination.total} tasks
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-neon disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-4 py-2 text-gray-400">Page {page}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!data?.data?.length || data.data.length < 20}
              className="btn-neon disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {!isLoading && !data?.data?.length && (
        <Card className="p-12 text-center">
          <p className="text-gray-400">No tasks found.</p>
        </Card>
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <div 
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setSelectedTask(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-900 border border-blue-500/30 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Task Details</h2>
              <button 
                onClick={() => setSelectedTask(null)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400">External ID</label>
                <p className="font-mono">{selectedTask.externalId}</p>
              </div>
              <div>
                <label className="text-sm text-gray-400">Status</label>
                <p className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${statusColors[selectedTask.status]}`}>
                  {selectedTask.status}
                </p>
              </div>
              <div>
                <label className="text-sm text-gray-400">Input</label>
                <pre className="bg-slate-800 rounded-lg p-4 text-sm overflow-x-auto">
                  {JSON.stringify(selectedTask.input, null, 2)}
                </pre>
              </div>
              {selectedTask.result && (
                <div>
                  <label className="text-sm text-gray-400">Result</label>
                  <pre className="bg-slate-800 rounded-lg p-4 text-sm overflow-x-auto">
                    {JSON.stringify(selectedTask.result, null, 2)}
                  </pre>
                </div>
              )}
              {selectedTask.error && (
                <div>
                  <label className="text-sm text-gray-400">Error</label>
                  <p className="text-red-400">{selectedTask.error}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <label className="text-gray-400">Created</label>
                  <p>{new Date(selectedTask.createdAt).toLocaleString()}</p>
                </div>
                {selectedTask.startedAt && (
                  <div>
                    <label className="text-gray-400">Started</label>
                    <p>{new Date(selectedTask.startedAt).toLocaleString()}</p>
                  </div>
                )}
                {selectedTask.completedAt && (
                  <div>
                    <label className="text-gray-400">Completed</label>
                    <p>{new Date(selectedTask.completedAt).toLocaleString()}</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
