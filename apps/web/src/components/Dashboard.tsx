'use client';

import useSWR from 'swr';
import { Activity, Box, Key, Zap } from 'lucide-react';
import { Card } from './ui/Card';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  trend?: string;
}

function StatCard({ title, value, icon: Icon, trend }: StatCardProps) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-400">{title}</p>
          <p className="text-3xl font-bold mt-2">{value}</p>
          {trend && <p className="text-sm text-primary mt-1">{trend}</p>}
        </div>
        <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
          <Icon className="w-6 h-6 text-primary" />
        </div>
      </div>
    </Card>
  );
}

export function Dashboard() {
  const { data: orgs } = useSWR('/api/admin/orgs', fetcher);
  const { data: projects } = useSWR('/api/admin/projects', fetcher);
  const { data: tasks } = useSWR('/api/admin/tasks', fetcher);
  const { data: apiKeys } = useSWR('/api/admin/api-keys', fetcher);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-gray-400 mt-1">Overview of your AI Agent Platform</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Organizations"
          value={orgs?.data?.length ?? 0}
          icon={Box}
        />
        <StatCard
          title="Projects"
          value={projects?.data?.length ?? 0}
          icon={Activity}
        />
        <StatCard
          title="API Keys"
          value={apiKeys?.data?.filter((k: any) => !k.revokedAt)?.length ?? 0}
          icon={Key}
        />
        <StatCard
          title="Tasks"
          value={tasks?.data?.length ?? 0}
          icon={Zap}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Recent Tasks</h3>
          {tasks?.data?.slice(0, 5).map((task: any) => (
            <div
              key={task.id}
              className="flex items-center justify-between py-3 border-b border-border last:border-0"
            >
              <div>
                <p className="font-medium">{task.goal}</p>
                <p className="text-sm text-gray-400">{task.project.name}</p>
              </div>
              <span
                className={`px-2 py-1 rounded text-xs font-medium ${
                  task.status === 'SUCCEEDED'
                    ? 'bg-success/20 text-success'
                    : task.status === 'FAILED'
                    ? 'bg-error/20 text-error'
                    : task.status === 'RUNNING'
                    ? 'bg-primary/20 text-primary'
                    : 'bg-gray-500/20 text-gray-400'
                }`}
              >
                {task.status}
              </span>
            </div>
          )) || (
            <p className="text-gray-400 text-sm">No tasks yet</p>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">System Status</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">API Server</span>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-success"></span>
                Online
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Worker</span>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-success"></span>
                Active
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Ollama</span>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-success"></span>
                Connected
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Database</span>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-success"></span>
                Healthy
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
