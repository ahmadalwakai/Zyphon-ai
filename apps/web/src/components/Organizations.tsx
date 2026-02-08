'use client';

import useSWR from 'swr';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { Card } from './ui/Card';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  maxSeats: number;
  createdAt: string;
}

export function Organizations() {
  const { data, error, isLoading, mutate } = useSWR<{ data: Organization[] }>('/api/admin/orgs', fetcher);
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({ name: '', slug: '', plan: 'free', maxSeats: 5 });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    if (res.ok) {
      mutate();
      setShowCreate(false);
      setFormData({ name: '', slug: '', plan: 'free', maxSeats: 5 });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this organization?')) return;
    const res = await fetch(`/api/admin/orgs/${id}`, { method: 'DELETE' });
    if (res.ok) mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Organizations</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-neon"
        >
          {showCreate ? 'Cancel' : '+ New Organization'}
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
                  <label className="block text-sm font-medium text-gray-400 mb-1">Slug</label>
                  <input
                    type="text"
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                    className="input-neon w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Plan</label>
                  <select
                    value={formData.plan}
                    onChange={(e) => setFormData({ ...formData, plan: e.target.value })}
                    className="input-neon w-full"
                  >
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Max Seats</label>
                  <input
                    type="number"
                    value={formData.maxSeats}
                    onChange={(e) => setFormData({ ...formData, maxSeats: parseInt(e.target.value) })}
                    className="input-neon w-full"
                    min={1}
                  />
                </div>
              </div>
              <button type="submit" className="btn-neon">Create Organization</button>
            </form>
          </Card>
        </motion.div>
      )}

      {isLoading && <p className="text-gray-400">Loading organizations...</p>}
      {error && <p className="text-red-400">Failed to load organizations</p>}

      <div className="grid gap-4">
        {data?.data?.map((org, index) => (
          <motion.div
            key={org.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">{org.name}</h3>
                  <p className="text-sm text-gray-400">Slug: {org.slug}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    org.plan === 'enterprise' ? 'bg-purple-500/20 text-purple-400' :
                    org.plan === 'pro' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {org.plan}
                  </span>
                  <span className="text-sm text-gray-400">{org.maxSeats} seats</span>
                  <button
                    onClick={() => handleDelete(org.id)}
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
          <p className="text-gray-400">No organizations yet. Create your first one!</p>
        </Card>
      )}
    </div>
  );
}
