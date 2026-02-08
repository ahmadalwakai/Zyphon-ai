'use client';

import useSWR from 'swr';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { Card } from './ui/Card';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface AuditLog {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actorType: string;
  actorId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export function AuditLogs() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const { data, error, isLoading } = useSWR<{ data: AuditLog[]; pagination: { total: number } }>(
    `/api/admin/audit?page=${page}&limit=50${actionFilter ? `&action=${actionFilter}` : ''}`,
    fetcher,
    { refreshInterval: 5000 }
  );
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const actionColors: Record<string, string> = {
    create: 'bg-green-500/20 text-green-400',
    update: 'bg-blue-500/20 text-blue-400',
    delete: 'bg-red-500/20 text-red-400',
    read: 'bg-gray-500/20 text-gray-400',
    login: 'bg-purple-500/20 text-purple-400',
    logout: 'bg-purple-500/20 text-purple-400',
  };

  const getActionColor = (action: string) => {
    const baseAction = action.split('.')[0];
    return actionColors[baseAction] || 'bg-gray-500/20 text-gray-400';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <div className="flex gap-4">
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            className="input-neon"
          >
            <option value="">All Actions</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
            <option value="read">Read</option>
            <option value="login">Login</option>
          </select>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Timestamp</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Action</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Resource</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Actor</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">IP Address</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-400"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    Loading audit logs...
                  </td>
                </tr>
              )}
              {error && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-red-400">
                    Failed to load audit logs
                  </td>
                </tr>
              )}
              {data?.data?.map((log, index) => (
                <motion.tr
                  key={log.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.02 }}
                  className="hover:bg-slate-800/30"
                >
                  <td className="px-4 py-3 text-sm text-gray-300">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getActionColor(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className="text-gray-300">{log.resource}</span>
                    {log.resourceId && (
                      <span className="text-gray-500 text-xs ml-2 font-mono">
                        {log.resourceId.slice(0, 8)}...
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {log.actorType}
                    {log.actorId && (
                      <span className="text-gray-500 text-xs ml-1">
                        ({log.actorId.slice(0, 8)}...)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">
                    {log.ipAddress || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedLog(log)}
                      className="text-blue-400 hover:text-blue-300 text-sm"
                    >
                      Details
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {data?.pagination && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">
            Total: {data.pagination.total} events
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
              disabled={!data?.data?.length || data.data.length < 50}
              className="btn-neon disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {!isLoading && !data?.data?.length && (
        <Card className="p-12 text-center">
          <p className="text-gray-400">No audit logs found.</p>
        </Card>
      )}

      {/* Log Detail Modal */}
      {selectedLog && (
        <div 
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setSelectedLog(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-900 border border-blue-500/30 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Audit Log Details</h2>
              <button 
                onClick={() => setSelectedLog(null)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-400">Action</label>
                  <p className={`inline-block px-2 py-1 rounded text-xs font-medium ${getActionColor(selectedLog.action)}`}>
                    {selectedLog.action}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-400">Resource</label>
                  <p>{selectedLog.resource}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-400">Resource ID</label>
                  <p className="font-mono text-sm">{selectedLog.resourceId || '-'}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-400">Actor</label>
                  <p>{selectedLog.actorType} {selectedLog.actorId ? `(${selectedLog.actorId})` : ''}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-400">IP Address</label>
                  <p className="font-mono">{selectedLog.ipAddress || '-'}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-400">Timestamp</label>
                  <p>{new Date(selectedLog.createdAt).toLocaleString()}</p>
                </div>
              </div>
              {selectedLog.userAgent && (
                <div>
                  <label className="text-sm text-gray-400">User Agent</label>
                  <p className="text-sm text-gray-300 break-all">{selectedLog.userAgent}</p>
                </div>
              )}
              {Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <label className="text-sm text-gray-400">Metadata</label>
                  <pre className="bg-slate-800 rounded-lg p-4 text-sm overflow-x-auto">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
