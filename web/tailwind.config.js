/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#060911',
        surface: '#0e1628',
        raised: '#141f38',
        edge: '#1e2a47',
        ink: '#e9edf7',
        muted: '#93a3bc',
        accent: '#6366f1',
        'accent-bright': '#8b93ff',
        teal: { DEFAULT: '#14b8a6', 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488' },
        amber: { DEFAULT: '#f59e0b', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
        danger: '#ef4444',
        ok: '#22c55e',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'ui-sans-serif', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { xl2: '14px' },
      boxShadow: {
        glow: '0 0 48px -10px rgba(99, 102, 241, 0.55)',
        'glow-teal': '0 0 42px -12px rgba(20, 184, 166, 0.5)',
        'glow-fuchsia': '0 0 42px -12px rgba(217, 70, 239, 0.45)',
        card: '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 14px 34px -14px rgba(0,0,0,0.75)',
        raised: '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 8px 20px -10px rgba(0,0,0,0.6)',
      },
      backgroundImage: {
        'grid-dots':
          'radial-gradient(rgba(148,163,184,0.14) 1px, transparent 1px)',
        'btn-primary': 'linear-gradient(135deg, #6366f1 0%, #7c5df0 55%, #8b5cf6 100%)',
      },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        pulseSoft: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
        drift: {
          '0%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(4%, 6%, 0) scale(1.12)' },
          '100%': { transform: 'translate3d(-4%, -3%, 0) scale(0.95)' },
        },
      },
      animation: {
        fadeUp: 'fadeUp 0.35s ease-out both',
        pulseSoft: 'pulseSoft 2s ease-in-out infinite',
        drift: 'drift 22s ease-in-out infinite alternate',
        'drift-slow': 'drift 30s ease-in-out -12s infinite alternate-reverse',
      },
    },
  },
  plugins: [],
};
