'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  CreditCard, 
  Zap, 
  CheckCircle2, 
  TrendingUp,
  Clock,
  ArrowUpRight
} from 'lucide-react';
import { useApp } from '../layout';

interface CreditHistoryItem {
  id: string;
  amount: number;
  balance: number;
  reason: string;
  createdAt: string;
}

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: '/month',
    credits: '100 credits',
    features: ['100 credits monthly', 'Basic code generation', '5 concurrent tasks'],
    current: true,
  },
  {
    name: 'Pro',
    price: '$29',
    period: '/month',
    credits: '2,000 credits',
    features: ['2,000 credits monthly', 'Image generation', 'Priority support', '20 concurrent tasks'],
    highlighted: true,
  },
  {
    name: 'Unlimited',
    price: '$99',
    period: '/month',
    credits: 'Unlimited',
    features: ['Unlimited credits', 'All Pro features', 'Dedicated support', 'Custom integrations'],
  },
];

export default function BillingPage() {
  const { user } = useApp();
  const [creditHistory, setCreditHistory] = useState<CreditHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch('/api/user/credits/history');
        if (res.ok) {
          const data = await res.json();
          setCreditHistory(data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch credit history:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, []);

  const currentPlan = plans.find(p => p.name.toUpperCase() === user?.plan) || plans[0];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-gray-400 mt-1">Manage your plan and credits</p>
      </div>

      {/* Current Credits */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface border border-border rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Available Credits</p>
              <p className="text-3xl font-bold">{user?.credits || 0}</p>
            </div>
          </div>
          <div className="h-2 bg-surface-light rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${Math.min((user?.credits || 0) / 100 * 100, 100)}%` }}
            />
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-success/20 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-success" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Current Plan</p>
              <p className="text-2xl font-bold">{currentPlan.name}</p>
            </div>
          </div>
          <p className="text-gray-400">{currentPlan.credits}</p>
        </div>

        <div className="bg-surface border border-border rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-warning/20 flex items-center justify-center">
              <Clock className="w-6 h-6 text-warning" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Credits Reset</p>
              <p className="text-2xl font-bold">Monthly</p>
            </div>
          </div>
          <p className="text-gray-400">Next reset in 30 days</p>
        </div>
      </div>

      {/* Plans */}
      <div>
        <h2 className="text-lg font-semibold mb-6">Upgrade Your Plan</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`relative p-6 rounded-xl ${
                plan.highlighted
                  ? 'bg-gradient-to-b from-primary/20 to-surface border-2 border-primary'
                  : 'bg-surface border border-border'
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary rounded-full text-xs font-medium">
                  Recommended
                </div>
              )}
              
              <div className="mb-4">
                <h3 className="text-xl font-bold">{plan.name}</h3>
                <div className="mt-2">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  <span className="text-gray-400">{plan.period}</span>
                </div>
              </div>

              <p className="text-primary font-medium mb-4">{plan.credits}</p>

              <ul className="space-y-2 mb-6">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm text-gray-300">
                    <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                disabled={plan.current}
                className={`w-full py-3 rounded-lg font-medium transition-colors ${
                  plan.current
                    ? 'bg-surface-light text-gray-400 cursor-not-allowed'
                    : plan.highlighted
                    ? 'bg-primary hover:bg-primary-dark'
                    : 'bg-surface-light hover:bg-border border border-border'
                }`}
              >
                {plan.current ? 'Current Plan' : 'Upgrade'}
              </button>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Credit History */}
      <div>
        <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          Credit History
        </h2>

        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {creditHistory.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              No credit history yet
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-surface-light">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-400">Date</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-400">Description</th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-gray-400">Amount</th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-gray-400">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {creditHistory.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-light/50">
                    <td className="px-6 py-4 text-sm">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm">{item.reason}</td>
                    <td className={`px-6 py-4 text-sm text-right font-medium ${
                      item.amount > 0 ? 'text-success' : 'text-error'
                    }`}>
                      {item.amount > 0 ? '+' : ''}{item.amount}
                    </td>
                    <td className="px-6 py-4 text-sm text-right text-gray-400">
                      {item.balance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
