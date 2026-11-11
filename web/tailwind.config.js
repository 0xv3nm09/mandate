/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Cream + orange editorial theme (matches deck & posters)
        bg: '#f2eee5',
        surface: '#fbfaf7',
        raised: '#ffffff',
        edge: '#ddd5c6',
        ink: '#141414',
        muted: '#6b6459',
        accent: '#fe4e1e',
        'accent-bright': '#d63a0f',
        teal: { DEFAULT: '#0f766e', 400: '#14b8a6', 500: '#0f766e', 600: '#0b5d57' },
        amber: { DEFAULT: '#b45309', 400: '#d97706', 500: '#b45309', 600: '#92400e' },
        danger: '#c81e1e',
        ok: '#15803d',
        white: '#ffffff',
        // warm neutrals, inverted so legacy light-on-dark classes read dark-on-cream
        slate: { 100: '#1f1c18', 200: '#26221d', 300: '#3a352e', 400: '#5a534a', 500: '#8a8174', 600: '#b3a998', 700: '#d6cdbd', 800: '#e7e0d3', 900: '#f2eee5' },
        indigo: { 200: '#b8320c', 300: '#c9390f', 400: '#fe6a3f', 500: '#fe4e1e', 600: '#d63a0f' },
        violet: { 300: '#c9390f', 500: '#fe4e1e' },
        purple: { 500: '#f0641f' },
        fuchsia: { 300: '#b8320c', 500: '#fe4e1e' },
        orange: { 500: '#f97316' },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque"', '"DM Sans"', 'ui-sans-serif', 'sans-serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { xl2: '14px' },
      boxShadow: {
        glow: '0 10px 28px -12px rgba(254, 78, 30, 0.55)',
        'glow-teal': '0 10px 26px -14px rgba(15, 118, 110, 0.45)',
        'glow-fuchsia': '0 10px 26px -14px rgba(254, 78, 30, 0.4)',
        card: '0 1px 0 0 rgba(20,20,20,0.03), 0 12px 30px -18px rgba(60,40,20,0.28)',
        raised: '0 1px 0 0 rgba(20,20,20,0.03), 0 6px 16px -10px rgba(60,40,20,0.22)',
      },
      backgroundImage: {
        'grid-dots':
          'radial-gradient(rgba(20,20,20,0.07) 1px, transparent 1px)',
        'btn-primary': 'linear-gradient(135deg, #fe4e1e 0%, #f0641f 100%)',
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
