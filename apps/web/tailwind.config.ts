import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#020617',
        surface: '#0F172A',
        'surface-light': '#1E293B',
        border: '#334155',
        primary: '#3B82F6',
        'primary-dark': '#2563EB',
        accent: '#3B82F6',
        'accent-glow': 'rgba(59, 130, 246, 0.5)',
        success: '#22C55E',
        warning: '#F59E0B',
        error: '#EF4444',
      },
      boxShadow: {
        'neon': '0 0 5px rgba(59, 130, 246, 0.5), 0 0 20px rgba(59, 130, 246, 0.3)',
        'neon-lg': '0 0 10px rgba(59, 130, 246, 0.6), 0 0 40px rgba(59, 130, 246, 0.4)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
