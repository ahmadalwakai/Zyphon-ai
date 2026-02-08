'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { 
  Cpu, 
  Zap, 
  Image as ImageIcon, 
  Code2, 
  ArrowRight, 
  CheckCircle2,
  Sparkles,
  Bot,
  Eye
} from 'lucide-react';

const features = [
  {
    icon: Bot,
    title: 'Autonomous Agents',
    description: 'AI agents that plan, execute, and verify tasks without constant supervision.',
  },
  {
    icon: Code2,
    title: 'Code Generation',
    description: 'Generate production-ready code across multiple languages and frameworks.',
  },
  {
    icon: ImageIcon,
    title: 'Image Generation',
    description: 'Create stunning visuals with Stable Diffusion 3 integration.',
  },
  {
    icon: Eye,
    title: 'Real-time Progress',
    description: 'Watch your tasks execute step-by-step with live updates.',
  },
  {
    icon: Zap,
    title: 'Fast Execution',
    description: 'Optimized pipeline for rapid task completion.',
  },
  {
    icon: Sparkles,
    title: 'Quality Assurance',
    description: 'Built-in critic agent verifies and refines results.',
  },
];

const pricingPlans = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Perfect for trying out Zyphon',
    credits: '100 credits/month',
    features: [
      '100 credits monthly',
      'Basic code generation',
      'Community support',
      '5 concurrent tasks',
    ],
    cta: 'Start Free',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$29',
    period: '/month',
    description: 'For serious builders',
    credits: '2,000 credits/month',
    features: [
      '2,000 credits monthly',
      'Full code generation',
      'Image generation',
      'Priority support',
      '20 concurrent tasks',
      'API access',
    ],
    cta: 'Get Pro',
    highlighted: true,
  },
  {
    name: 'Unlimited',
    price: '$99',
    period: '/month',
    description: 'For power users',
    credits: 'Unlimited credits',
    features: [
      'Unlimited credits',
      'All Pro features',
      'Dedicated support',
      'Unlimited concurrent tasks',
      'Custom integrations',
      'SLA guarantee',
    ],
    cta: 'Go Unlimited',
    highlighted: false,
  },
];

export default function LandingPage() {
  return (
    <div>
      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
        {/* Background Effects */}
        <div className="absolute inset-0 bg-gradient-radial from-primary/20 via-transparent to-transparent" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/30 rounded-full blur-[128px] animate-pulse-slow" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/20 rounded-full blur-[128px] animate-pulse-slow delay-1000" />

        <div className="relative max-w-7xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 mb-8">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm text-gray-300">Autonomous AI Agents are here</span>
            </div>

            <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
              <span className="bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
                Your AI Agent
              </span>
              <br />
              <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                Does the Work
              </span>
            </h1>

            <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
              Describe your goal. Watch it happen. Zyphon&apos;s autonomous agents plan, 
              execute, and deliver — code, images, and more — while you focus on what matters.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/signup"
                className="group flex items-center gap-2 px-8 py-4 bg-primary hover:bg-primary-dark rounded-xl font-semibold text-lg transition-all shadow-neon hover:shadow-neon-lg"
              >
                Start Building Free
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="/docs"
                className="flex items-center gap-2 px-8 py-4 border border-border hover:border-primary/50 rounded-xl font-semibold text-lg transition-all"
              >
                View API Docs
              </Link>
            </div>
          </motion.div>

          {/* Hero Demo */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="mt-20"
          >
            <div className="relative max-w-4xl mx-auto">
              <div className="absolute -inset-4 bg-gradient-to-r from-primary/50 to-accent/50 rounded-2xl blur-xl opacity-30" />
              <div className="relative bg-surface border border-border rounded-2xl overflow-hidden shadow-2xl">
                {/* Mock Terminal Header */}
                <div className="flex items-center gap-2 px-4 py-3 bg-surface-light border-b border-border">
                  <div className="w-3 h-3 rounded-full bg-error" />
                  <div className="w-3 h-3 rounded-full bg-warning" />
                  <div className="w-3 h-3 rounded-full bg-success" />
                  <span className="ml-4 text-sm text-gray-400">Task Execution</span>
                </div>
                
                {/* Mock Task UI */}
                <div className="p-6 text-left">
                  <div className="mb-6">
                    <p className="text-sm text-gray-400 mb-2">Goal</p>
                    <p className="text-lg">&quot;Build a REST API for user authentication with JWT tokens&quot;</p>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-success/10 border border-success/30 rounded-lg">
                      <CheckCircle2 className="w-5 h-5 text-success" />
                      <span className="text-gray-300">Plan created: 5 steps</span>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-success/10 border border-success/30 rounded-lg">
                      <CheckCircle2 className="w-5 h-5 text-success" />
                      <span className="text-gray-300">Generated user schema and models</span>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-success/10 border border-success/30 rounded-lg">
                      <CheckCircle2 className="w-5 h-5 text-success" />
                      <span className="text-gray-300">Created authentication routes</span>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/30 rounded-lg animate-pulse">
                      <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                      <span className="text-gray-300">Implementing JWT middleware...</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl font-bold mb-4">
              Everything you need to ship faster
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Zyphon combines multiple AI capabilities into a single autonomous platform.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                className="group p-6 bg-surface border border-border rounded-xl hover:border-primary/50 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center mb-4 group-hover:shadow-neon transition-shadow duration-300">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-gray-400">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 bg-surface/50">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl font-bold mb-4">How Zyphon Works</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Three simple steps from idea to execution
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Describe Your Goal',
                description: 'Write what you want to achieve in natural language. Be as specific as you need.',
              },
              {
                step: '02',
                title: 'Agent Plans',
                description: 'Our AI agents analyze your request and create an optimal execution plan.',
              },
              {
                step: '03',
                title: 'Watch & Receive',
                description: 'See real-time progress as agents execute. Download your results when done.',
              },
            ].map((item, index) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.2 }}
                className="relative"
              >
                <div className="text-8xl font-bold text-primary/10 absolute -top-6 -left-2">
                  {item.step}
                </div>
                <div className="relative pt-8">
                  <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                  <p className="text-gray-400">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl font-bold mb-4">Simple, transparent pricing</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Start free, upgrade when ready. No hidden fees.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {pricingPlans.map((plan, index) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                className={`relative p-8 rounded-2xl ${
                  plan.highlighted
                    ? 'bg-gradient-to-b from-primary/20 to-surface border-2 border-primary shadow-neon'
                    : 'bg-surface border border-border'
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-primary rounded-full text-sm font-medium">
                    Most Popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                  <p className="text-gray-400 text-sm">{plan.description}</p>
                </div>
                <div className="mb-6">
                  <span className="text-5xl font-bold">{plan.price}</span>
                  <span className="text-gray-400">{plan.period}</span>
                </div>
                <p className="text-primary font-medium mb-6">{plan.credits}</p>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3">
                      <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                      <span className="text-gray-300">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`block w-full py-3 text-center rounded-lg font-medium transition-all ${
                    plan.highlighted
                      ? 'bg-primary hover:bg-primary-dark'
                      : 'bg-surface-light hover:bg-border border border-border'
                  }`}
                >
                  {plan.cta}
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-accent/10 to-primary/20" />
        <div className="relative max-w-4xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Ready to build with AI?
            </h2>
            <p className="text-xl text-gray-400 mb-10">
              Join thousands of developers using Zyphon to ship faster.
            </p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-8 py-4 bg-primary hover:bg-primary-dark rounded-xl font-semibold text-lg transition-all shadow-neon hover:shadow-neon-lg"
            >
              Get Started Free
              <ArrowRight className="w-5 h-5" />
            </Link>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
