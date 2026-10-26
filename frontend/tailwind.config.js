/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Complete 50-950 dynamic brand scale with alpha channel support
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
          950: 'rgb(var(--brand-950) / <alpha-value>)',
          dark: 'rgb(var(--brand-dark) / <alpha-value>)',
          contrast: 'rgb(var(--brand-contrast) / <alpha-value>)',
          DEFAULT: 'rgb(var(--brand-500) / <alpha-value>)'
        },
        // Flat surfaces
        surface: {
          page: 'rgb(var(--bg-page) / <alpha-value>)',
          card: 'rgb(var(--bg-surface) / <alpha-value>)',
          raised: 'rgb(var(--bg-surface-raised) / <alpha-value>)',
          overlay: 'rgb(var(--bg-surface-overlay) / <alpha-value>)'
        },
        // Subtle 1px borders
        border: {
          subtle: 'rgb(var(--border-subtle) / <alpha-value>)',
          muted: 'rgb(var(--border-muted) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)'
        },
        // Typography content hierarchy
        content: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
          disabled: 'rgb(var(--text-disabled) / <alpha-value>)'
        },
        // Semantic Lending Status Token Families
        status: {
          hot: {
            DEFAULT: 'rgb(var(--status-hot) / <alpha-value>)',
            bg: 'rgb(var(--status-hot-bg) / <alpha-value>)',
            border: 'rgb(var(--status-hot-border) / <alpha-value>)',
            text: 'rgb(var(--status-hot-text) / <alpha-value>)'
          },
          warm: {
            DEFAULT: 'rgb(var(--status-warm) / <alpha-value>)',
            bg: 'rgb(var(--status-warm-bg) / <alpha-value>)',
            border: 'rgb(var(--status-warm-border) / <alpha-value>)',
            text: 'rgb(var(--status-warm-text) / <alpha-value>)'
          },
          info: {
            DEFAULT: 'rgb(var(--status-info) / <alpha-value>)',
            bg: 'rgb(var(--status-info-bg) / <alpha-value>)',
            border: 'rgb(var(--status-info-border) / <alpha-value>)',
            text: 'rgb(var(--status-info-text) / <alpha-value>)'
          },
          success: {
            DEFAULT: 'rgb(var(--status-success) / <alpha-value>)',
            bg: 'rgb(var(--status-success-bg) / <alpha-value>)',
            border: 'rgb(var(--status-success-border) / <alpha-value>)',
            text: 'rgb(var(--status-success-text) / <alpha-value>)'
          },
          pending: {
            DEFAULT: 'rgb(var(--status-pending) / <alpha-value>)',
            bg: 'rgb(var(--status-pending-bg) / <alpha-value>)',
            border: 'rgb(var(--status-pending-border) / <alpha-value>)',
            text: 'rgb(var(--status-pending-text) / <alpha-value>)'
          },
          danger: {
            DEFAULT: 'rgb(var(--status-danger) / <alpha-value>)',
            bg: 'rgb(var(--status-danger-bg) / <alpha-value>)',
            border: 'rgb(var(--status-danger-border) / <alpha-value>)',
            text: 'rgb(var(--status-danger-text) / <alpha-value>)'
          },
          neutral: {
            DEFAULT: 'rgb(var(--status-neutral) / <alpha-value>)',
            bg: 'rgb(var(--status-neutral-bg) / <alpha-value>)',
            border: 'rgb(var(--status-neutral-border) / <alpha-value>)',
            text: 'rgb(var(--status-neutral-text) / <alpha-value>)'
          }
        },
        // Legacy compatibility
        navy: {
          50: '#F0F3F9',
          100: '#D9E2EC',
          200: '#B0C2DE',
          600: '#24324A',
          800: '#17223B',
          900: '#0F172A',
        },
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        sidebar: {
          bg: 'var(--sidebar-bg)',
          text: 'var(--sidebar-text, #ffffff)',
          hover: 'var(--sidebar-hover, rgba(255,255,255,0.08))'
        },
        header: {
          bg: 'var(--header-bg)',
          text: 'var(--header-text, #1e293b)'
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans Variable', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      // Namespaced border radius (preserving default rounded-sm/md/lg)
      borderRadius: {
        card: 'var(--radius-card, 12px)',
        control: 'var(--radius-control, 8px)',
        overlay: 'var(--radius-overlay, 16px)'
      },
      // Namespaced layered soft shadows (preserving default shadow-sm/md/lg)
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        raised: 'var(--shadow-raised)',
        overlay: 'var(--shadow-overlay)',
        premium: '0 4px 20px -2px rgba(23, 34, 59, 0.04), 0 2px 6px -1px rgba(23, 34, 59, 0.02)',
        'premium-hover': '0 12px 28px -4px rgba(23, 34, 59, 0.07), 0 4px 12px -2px rgba(23, 34, 59, 0.04)',
        glass: '0 8px 32px 0 rgba(31, 38, 135, 0.07)'
      },
      transitionTimingFunction: {
        'brand-out': 'cubic-bezier(0.16, 1, 0.3, 1)'
      }
    },
  },
  plugins: [],
}
