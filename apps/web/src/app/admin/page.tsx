'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Sidebar } from '../../components/Sidebar';
import { Dashboard } from '../../components/Dashboard';
import { Organizations } from '../../components/Organizations';
import { Projects } from '../../components/Projects';
import { ApiKeys } from '../../components/ApiKeys';
import { Tasks } from '../../components/Tasks';
import { AuditLogs } from '../../components/AuditLogs';

type View = 'dashboard' | 'organizations' | 'projects' | 'api-keys' | 'tasks' | 'audit';

export default function Home() {
  const [currentView, setCurrentView] = useState<View>('dashboard');

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'organizations':
        return <Organizations />;
      case 'projects':
        return <Projects />;
      case 'api-keys':
        return <ApiKeys />;
      case 'tasks':
        return <Tasks />;
      case 'audit':
        return <AuditLogs />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar currentView={currentView} onNavigate={setCurrentView} />
      <main className="flex-1 overflow-auto p-6">
        <motion.div
          key={currentView}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {renderView()}
        </motion.div>
      </main>
    </div>
  );
}
