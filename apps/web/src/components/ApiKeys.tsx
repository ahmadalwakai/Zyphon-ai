'use client';

import useSWR from 'swr';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { Card } from './ui/Card';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  organizationId: string;
  scopes: string[];
  rateLimit: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  organization?: { name: string };
}

export function ApiKeys() {
  const { data, error, isLoading, mutate } = useSWR<{ data: ApiKey[] }>('/api/admin/api-keys', fetcher);
  const { data: orgsData } = useSWR<{ data: { id: string; name: string }[] }>('/api/admin/orgs', fetcher);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    organizationId: '',
    scopes: ['tasks:read', 'tasks:write'],
    rateLimit: 1000,
    expiresInDays: 90,
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    if (res.ok) {
      const result = await res.json();
      setNewKey(result.key);
      mutate();
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key?')) return;
    const res = await fetch(`/api/admin/api-keys/${id}`, { method: 'DELETE' });
    if (res.ok) mutate();
  };

  const scopeOptions = [
    'tasks:read',
    'tasks:write',
    'projects:read',
    'projects:write',
    'artifacts:read',
    'artifacts:write',
  ];

  const toggleScope = (scope: string) => {
    const newScopes = formData.scopes.includes(scope)
      ? formData.scopes.filter(s => s !== scope)
      : [...formData.scopes, scope];
    setFormData({ ...formData, scopes: newScopes });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">API Keys</h1>
        <button
          onClick={() => { setShowCreate(!showCreate); setNewKey(null); }}
          className="btn-neon"
        >
          {showCreate ? 'Cancel' : '+ New API Key'}
        </button>
      </div>

      {newKey && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Card className="p-6 border-green-500/50">
            <h3 className="text-lg font-semibold text-green-400 mb-2">API Key Created!</h3>
            <p className="text-sm text-gray-400 mb-4">
              Copy this key now. You won't be able to see it again.
            </p>
            <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm break-all">
              {newKey}
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(newKey); }}
              className="btn-neon mt-4"
            >
              Copy to Clipboard
            </button>
          </Card>
        </motion.div>
      )}

      {showCreate && !newKey && (
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
                    placeholder="Production API Key"
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
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Rate Limit (req/hour)</label>
                  <input
                    type="number"
                    value={formData.rateLimit}
                    onChange={(e) => setFormData({ ...formData, rateLimit: parseInt(e.target.value) })}
                    className="input-neon w-full"
                    min={1}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Expires In (days)</label>
                  <input
                    type="number"
                    value={formData.expiresInDays}
                    onChange={(e) => setFormData({ ...formData, expiresInDays: parseInt(e.target.value) })}
                    className="input-neon w-full"
                    min={1}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Scopes</label>
                <div className="flex flex-wrap gap-2">
                  {scopeOptions.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => toggleScope(scope)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        formData.scopes.includes(scope)
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                          : 'bg-gray-700/50 text-gray-400 border border-gray-600/50'
                      }`}
                    >
                      {scope}
                    </button>
                  ))}
                </div>
              </div>
              <button type="submit" className="btn-neon">Create API Key</button>
            </form>
          </Card>
        </motion.div>
      )}

      {isLoading && <p className="text-gray-400">Loading API keys...</p>}
      {error && <p className="text-red-400">Failed to load API keys</p>}

      <div className="grid gap-4">
        {data?.data?.map((apiKey, index) => (
          <motion.div
            key={apiKey.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">{apiKey.name}</h3>
                  <p className="text-sm text-gray-400 font-mono">{apiKey.keyPrefix}...</p>
                  <div className="flex gap-2 mt-2">
                    {apiKey.scopes.map((scope) => (
                      <span key={scope} className="px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-400">
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="text-sm text-gray-400">
                    {apiKey.rateLimit} req/hr
                  </span>
                  {apiKey.lastUsedAt && (
                    <span className="text-xs text-gray-500">
                      Last used: {new Date(apiKey.lastUsedAt).toLocaleDateString()}
                    </span>
                  )}
                  <button
                    onClick={() => handleRevoke(apiKey.id)}
                    className="text-red-400 hover:text-red-300 transition-colors text-sm"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {!isLoading && !data?.data?.length && (
        <Card className="p-12 text-center">
          <p className="text-gray-400">No API keys yet. Create your first one!</p>
        </Card>
      )}
    </div>
  );
}
