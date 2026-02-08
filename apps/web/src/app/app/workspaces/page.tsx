'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Plus,
  FolderKanban,
  Zap,
  Loader2,
  MoreVertical,
  Trash2,
  Edit3,
} from 'lucide-react';

interface Workspace {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  _count: { tasks: number };
}

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchWorkspaces() {
      try {
        const res = await fetch('/api/user/workspaces');
        if (res.ok) {
          const data = await res.json();
          setWorkspaces(data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch workspaces:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchWorkspaces();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this workspace? All tasks will be deleted.')) {
      return;
    }
    try {
      const res = await fetch(`/api/user/workspaces/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setWorkspaces(ws => ws.filter(w => w.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete workspace:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workspaces</h1>
          <p className="text-gray-400 mt-1">Organize your tasks into workspaces</p>
        </div>
        <Link
          href="/app/workspaces/new"
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark rounded-lg font-medium transition-colors"
        >
          <Plus className="w-5 h-5" />
          New Workspace
        </Link>
      </div>

      {/* Workspaces Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-border rounded-xl">
          <FolderKanban className="w-16 h-16 mx-auto text-gray-600 mb-4" />
          <h3 className="text-lg font-medium mb-2">No workspaces yet</h3>
          <p className="text-gray-400 mb-6">Create a workspace to organize your AI tasks</p>
          <Link
            href="/app/workspaces/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark rounded-lg font-medium transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Workspace
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workspaces.map((ws, index) => (
            <motion.div
              key={ws.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="group relative bg-surface border border-border rounded-xl p-6 hover:border-primary/50 transition-all"
            >
              <Link href={`/app/workspaces/${ws.id}`} className="block">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                    <FolderKanban className="w-6 h-6 text-primary" />
                  </div>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      handleDelete(ws.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-2 hover:bg-surface-light rounded-lg transition-all"
                  >
                    <Trash2 className="w-4 h-4 text-gray-400 hover:text-error" />
                  </button>
                </div>
                <h3 className="text-lg font-semibold mb-1">{ws.name}</h3>
                {ws.description && (
                  <p className="text-sm text-gray-400 mb-4 line-clamp-2">{ws.description}</p>
                )}
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  <span className="flex items-center gap-1">
                    <Zap className="w-4 h-4" />
                    {ws._count.tasks} tasks
                  </span>
                  <span>
                    Created {new Date(ws.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
