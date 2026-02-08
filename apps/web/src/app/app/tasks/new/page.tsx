'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  ArrowLeft, 
  Zap, 
  Code2, 
  Image as ImageIcon, 
  Loader2,
  FolderKanban,
  Sparkles,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';

interface Workspace {
  id: string;
  name: string;
}

export default function NewTaskPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Check if refining from previous task
  const refineFrom = searchParams.get('refineFrom');
  const initialGoal = searchParams.get('goal') || '';
  const initialContext = searchParams.get('context') || '';

  const [goal, setGoal] = useState(initialGoal);
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingWs, setLoadingWs] = useState(true);
  const [estimatedCredits, setEstimatedCredits] = useState(0);

  // Auto-detect task type from goal
  const detectTaskType = (text: string): 'CODING' | 'IMAGE' | 'MIXED' => {
    const lower = text.toLowerCase();
    const imageKeywords = ['image', 'photo', 'picture', 'generate', 'create an image', 'cinematic', '16:9', '4:3'];
    const codeKeywords = ['page', 'component', 'code', 'website', 'app', 'function', 'api'];
    
    const hasImage = imageKeywords.some(k => lower.includes(k));
    const hasCode = codeKeywords.some(k => lower.includes(k));
    
    if (hasImage && hasCode) return 'MIXED';
    if (hasImage) return 'IMAGE';
    return 'CODING';
  };

  const taskType = detectTaskType(goal);

  // Estimate credits based on task type
  useEffect(() => {
    let estimate = 5; // base cost
    if (taskType === 'IMAGE') estimate += 50;
    else if (taskType === 'MIXED') estimate += 60;
    else estimate += 15;
    setEstimatedCredits(estimate);
  }, [taskType]);

  useEffect(() => {
    async function loadWorkspaces() {
      try {
        const res = await fetch('/api/user/workspaces');
        if (res.ok) {
          const data = await res.json();
          setWorkspaces(data.data || []);
          if (data.data?.length > 0) {
            setWorkspaceId(data.data[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load workspaces:', err);
      } finally {
        setLoadingWs(false);
      }
    }
    loadWorkspaces();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) {
      setError('Please select or create a workspace first');
      return;
    }
    
    setError('');
    setLoading(true);

    try {
      const context = refineFrom 
        ? `Refined from task ${refineFrom}. ${initialContext}`.trim()
        : undefined;

      const res = await fetch('/api/user/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          goal,
          context,
          type: taskType,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to create task');
      }

      // Start execution
      await fetch(`/api/user/tasks/${data.data.id}/run`, { method: 'POST' });

      // Redirect to task detail
      router.push(`/app/tasks/${data.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  };

  const exampleGoals = [
    {
      type: 'IMAGE' as const,
      icon: ImageIcon,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/30',
      text: 'Create a 16:9 cinematic image of horses running in the Scottish Highlands',
    },
    {
      type: 'CODING' as const,
      icon: Code2,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/30',
      text: 'Create a Next.js page with neon dark theme cards showing user profiles',
    },
    {
      type: 'MIXED' as const,
      icon: Zap,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
      border: 'border-cyan-500/30',
      text: 'Build a landing page with hero image, run build, and take a screenshot',
    },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/app/tasks"
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Tasks
        </Link>
        
        <div className="flex items-center gap-3 mb-2">
          {refineFrom && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary text-sm rounded-full">
              <Sparkles className="w-3.5 h-3.5" />
              Refining
            </span>
          )}
          <h1 className="text-2xl font-bold">
            {refineFrom ? 'Refine Task' : 'New Task'}
          </h1>
        </div>
        <p className="text-gray-400">
          Describe what you want the AI agent to accomplish. Be specific.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Error */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 p-4 bg-error/10 border border-error/30 rounded-xl text-error"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </motion.div>
        )}

        {/* Workspace Selection */}
        {loadingWs ? (
          <div className="flex items-center gap-2 text-gray-400 p-4 bg-surface rounded-xl">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading workspaces...
          </div>
        ) : workspaces.length === 0 ? (
          <div className="p-4 bg-surface border border-border rounded-xl">
            <p className="text-gray-400 mb-3">You need a workspace to create tasks</p>
            <Link
              href="/app/workspaces/new"
              className="inline-flex items-center gap-2 text-primary hover:underline"
            >
              <FolderKanban className="w-4 h-4" />
              Create a workspace
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <label className="text-sm text-gray-400">Workspace:</label>
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="flex-1 px-4 py-2.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-primary transition-colors"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Goal Input - Main Focus */}
        <div className="relative">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            required
            rows={5}
            maxLength={2000}
            className="w-full px-5 py-4 bg-surface border-2 border-border rounded-2xl focus:outline-none focus:border-primary transition-all resize-none text-lg placeholder:text-gray-500"
            placeholder="What should the AI accomplish?"
          />
          
          {/* Task type indicator */}
          <div className="absolute bottom-4 left-4 flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              taskType === 'IMAGE' ? 'bg-purple-500/20 text-purple-400' :
              taskType === 'MIXED' ? 'bg-cyan-500/20 text-cyan-400' :
              'bg-blue-500/20 text-blue-400'
            }`}>
              {taskType === 'IMAGE' && <ImageIcon className="w-3 h-3" />}
              {taskType === 'CODING' && <Code2 className="w-3 h-3" />}
              {taskType === 'MIXED' && <Zap className="w-3 h-3" />}
              {taskType}
            </span>
            <span className="text-xs text-gray-500">{goal.length}/2000</span>
          </div>
        </div>

        {/* Example Goals */}
        {!goal && (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">Try an example:</p>
            <div className="grid gap-3">
              {exampleGoals.map((example, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setGoal(example.text)}
                  className={`p-4 text-left rounded-xl border ${example.border} ${example.bg} hover:opacity-80 transition-opacity`}
                >
                  <div className="flex items-start gap-3">
                    <example.icon className={`w-5 h-5 ${example.color} flex-shrink-0 mt-0.5`} />
                    <div>
                      <span className={`text-xs font-medium ${example.color}`}>{example.type}</span>
                      <p className="text-sm text-gray-300 mt-1">{example.text}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Credit Estimate */}
        <div className="flex items-center justify-between p-4 bg-surface-light rounded-xl">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Zap className="w-4 h-4 text-primary" />
            Estimated cost
          </div>
          <span className="font-medium text-primary">{estimatedCredits} credits</span>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !goal.trim() || !workspaceId}
          className="w-full py-4 bg-primary hover:bg-primary-dark rounded-xl font-medium flex items-center justify-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-neon hover:shadow-neon-lg text-lg"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Starting Task...
            </>
          ) : (
            <>
              <Zap className="w-5 h-5" />
              Execute Task
              <ChevronRight className="w-5 h-5" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
