'use client';

import useSWR from 'swr';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { Card } from './ui/Card';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface Project {
  id: string;
  name: string;
  organizationId: string;
  settings: Record<string, unknown>;
  createdAt: string;
  organization?: { name: string };
}

export function Projects() {
  const { data, error, isLoading, mutate } = useSWR<{ data: Project[] }>('/api/admin/projects', fetcher);
  const { data: orgsData } = useSWR<{ data: { id: string; name: string }[] }>('/api/admin/orgs', fetcher);
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({ name: '', organizationId: '' });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    if (res.ok) {
      mutate();
      setShowCreate(false);
      setFormData({ name: '', organizationId: '' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    const res = await fetch(`/api/admin/projects/${id}`, { method: 'DELETE' });
    if (res.ok) mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-neon"
        >
          {showCreate ? 'Cancel' : '+ New Project'}
        </button>
      </div>

      {showCreate && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="p-6">
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input-neon w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Organization</label>
                  <select
                    value={formData.organizationId}
                    onChange={(e) => setFormData({ ...formData, organizationId: e.target.value })}
                    className="input-neon w-full"
                    required
                  >
                    <option value="">Select organization...</option>
                    {orgsData?.data?.map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button type="submit" className="btn-neon">Create Project</button>
            </form>
          </Card>
        </motion.div>
      )}

      {isLoading && <p className="text-gray-400">Loading projects...</p>}
      {error && <p className="text-red-400">Failed to load projects</p>}

      <div className="grid gap-4">
        {data?.data?.map((project, index) => (
          <motion.div
            key={project.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">{project.name}</h3>
                  <p className="text-sm text-gray-400">
                    Organization: {project.organization?.name || project.organizationId}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-500">
                    {new Date(project.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => handleDelete(project.id)}
                    className="text-red-400 hover:text-red-300 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {!isLoading && !data?.data?.length && (
        <Card className="p-12 text-center">
          <p className="text-gray-400">No projects yet. Create your first one!</p>
        </Card>
      )}
    </div>
  );
}
