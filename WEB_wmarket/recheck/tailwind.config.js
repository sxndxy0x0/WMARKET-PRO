/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // v15 — dark theme (redesign per user reference, Aug 2026): near-navy
        // surfaces, cyan/blue accent, brighter green/red readable on dark bg.
        // These tokens are the last few spots (error banners, small
        // fallback icons) not already using raw dark utility classes
        // directly — kept here so they stay in sync automatically.
        surface: {
          DEFAULT: '#0b0f1c',
          sunken: '#141b30',
          sidebar: '#0a0e18',
        },
        border: {
          DEFAULT: 'rgba(255,255,255,0.1)',
        },
        ink: {
          900: '#e6ecf5',
          700: '#cbd5e1',
          500: '#94a3b8',
          400: '#64748b',
        },
        brand: {
          50: 'rgba(34,211,238,0.08)',
          100: 'rgba(34,211,238,0.15)',
          500: '#22D3EE',
          600: '#0EA5C4',
        },
        gain: '#34D399',
        loss: '#F87171',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'var(--font-thai)', 'Inter', 'Noto Sans Thai', 'Noto Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(16, 24, 40, 0.05)',
        popover: '0 8px 24px -4px rgba(16, 24, 40, 0.12)',
      },
      borderRadius: {
        xl: '0.875rem',
      },
    },
  },
  plugins: [],
};
