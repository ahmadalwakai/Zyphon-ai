'use client';

import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Building2,
  FolderKanban,
  Key,
  ListTodo,
  ScrollText,
  Zap,
} from 'lucide-react';
import { clsx } from 'clsx';

type View = 'dashboard' | 'organizations' | 'projects' | 'api-keys' | 'tasks' | 'audit';

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

const navItems: { id: View; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'organizations', label: 'Organizations', icon: Building2 },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'api-keys', label: 'API Keys', icon: Key },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'audit', label: 'Audit Logs', icon: ScrollText },
];

export function Sidebar({ currentView, onNavigate }: SidebarProps) {
  return (
    <aside className="w-64 bg-surface border-r border-border flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center shadow-neon">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Zyphon</h1>
            <p className="text-xs text-gray-400">AI Agent Platform</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={clsx(
                'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all',
                isActive
                  ? 'bg-primary/20 text-primary border border-primary/50 shadow-neon'
                  : 'text-gray-400 hover:text-white hover:bg-surface-light'
              )}
            >
              <Icon className="w-5 h-5" />
              {item.label}
              {isActive && (
                <motion.div
                  layoutId="activeIndicator"
                  className="ml-auto w-2 h-2 rounded-full bg-primary"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <div className="text-xs text-gray-500">
          <p>API: localhost:3002</p>
          <p>Worker: Active</p>
        </div>
      </div>
    </aside>
  );
}
