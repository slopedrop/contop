/** @type {import('tailwindcss').Config} */
module.exports = {
  corePlugins: {
    preflight: false, // Docusaurus has its own CSS reset (Infima)
  },
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './docs/**/*.{md,mdx}',
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        contop: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3B82F6',
          600: '#095BB9',
          700: '#074a96',
          800: '#064082',
          900: '#043063',
          950: '#021d3d',
        },
        surface: {
          light: '#F8F9FA',
          DEFAULT: '#0a0a0b',
          dark: '#111113',
        },
        border: {
          light: '#E5E7EB',
          DEFAULT: 'rgba(255, 255, 255, 0.08)',
          strong: {
            light: '#D1D5DB',
            DEFAULT: 'rgba(255, 255, 255, 0.15)',
          },
          hover: {
            light: 'rgba(9, 91, 185, 0.4)',
            DEFAULT: 'rgba(59, 130, 246, 0.4)',
          },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'ui-monospace', 'monospace'],
      },
      maxWidth: {
        shell: '1400px',
      },
      borderRadius: {
        card: '12px',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' },
        },
      },
    },
  },
  plugins: [],
};
