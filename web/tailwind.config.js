/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // 项目使用 <html data-theme="dark|light"> 切换主题，
  // 通过 selector 模式让 Tailwind 的 dark: 变体与此对齐。
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Inter', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        body: ['Inter', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
      },
      colors: {
        // ===== shadcn/ui 设计令牌（HSL）=====
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          // 兼容旧色阶类（bg-primary-500/10、text-primary-300 等）→ 中性主色
          200: 'hsl(var(--primary))',
          300: 'hsl(var(--primary))',
          400: 'hsl(var(--primary))',
          500: 'hsl(var(--primary))',
          600: 'hsl(var(--primary))',
          700: 'hsl(var(--primary))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // ===== 兼容别名：老代码里的语义色 → 中性令牌 =====
        neon: {
          blue: 'hsl(var(--primary))',
          purple: 'hsl(var(--accent))',
          pink: 'hsl(var(--destructive))',
          green: 'hsl(var(--success))',
        },
        surface: {
          50: 'hsl(var(--surface-50))',
          100: 'hsl(var(--surface-100))',
          200: 'hsl(var(--surface-200))',
          300: 'hsl(var(--surface-300))',
          400: 'hsl(var(--surface-400))',
          500: 'hsl(var(--surface-500))',
          600: 'hsl(var(--surface-600))',
          700: 'hsl(var(--surface-700))',
          800: 'hsl(var(--surface-800))',
          900: 'hsl(var(--surface-900))',
          950: 'hsl(var(--surface-950))',
        },
        /* 语义化主题色 — 引用 CSS 变量，随主题切换自动变化 */
        theme: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          muted: 'var(--text-muted)',
          'on-neon': 'var(--text-on-neon)',
          'bg-base': 'var(--bg-base)',
          'bg-surface': 'var(--bg-surface)',
          'bg-elevated': 'var(--bg-elevated)',
          'bg-card': 'var(--bg-card)',
        },
      },
      backgroundImage: {
        'neon-gradient': 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))',
        'neon-gradient-h': 'linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))',
        'neon-gradient-v': 'linear-gradient(180deg, hsl(var(--primary)), hsl(var(--accent)))',
        'deep-space': 'radial-gradient(ellipse at 20% 50%, var(--deco-glow-blue) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, var(--deco-glow-purple) 0%, transparent 50%)',
        'glass-border': 'linear-gradient(135deg, var(--neon-blue-20), var(--neon-purple-20))',
      },
      boxShadow: {
        'neon-blue': 'var(--neon-glow-shadow-lg)',
        'neon-purple': 'var(--neon-glow-shadow-lg)',
        'neon-glow': 'var(--neon-glow-shadow-xl)',
        'card-hover': 'var(--shadow-card-hover)',
        'glass': 'var(--shadow-card)',
        'inner-glow': 'var(--glass-panel-inset)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-down': 'slideDown 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'neon-breathe': 'neonBreathe 3s ease-in-out infinite',
        'slide-right': 'slideRight 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        'float': 'float 6s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'energy-flow': 'energyFlow 2s linear infinite',
        'ripple': 'ripple 0.6s ease-out',
        'particle-burst': 'particleBurst 0.5s ease-out forwards',
        'page-enter': 'pageEnter 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
        'dialog-content-in': 'dialog-content-in 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        'dialog-content-out': 'dialog-content-out 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        'dialog-overlay-in': 'dialog-overlay-in 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        'dialog-overlay-out': 'dialog-overlay-out 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', filter: 'blur(4px)' },
          '100%': { opacity: '1', filter: 'blur(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)', filter: 'blur(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-20px)', filter: 'blur(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.9)', filter: 'blur(4px)' },
          '100%': { opacity: '1', transform: 'scale(1)', filter: 'blur(0)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 15px hsl(var(--primary) / 0.2)' },
          '50%': { boxShadow: '0 0 25px hsl(var(--primary) / 0.4), 0 0 50px hsl(var(--primary) / 0.1)' },
        },
        neonBreathe: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        slideRight: {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        energyFlow: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        ripple: {
          '0%': { transform: 'scale(0.8)', opacity: '1' },
          '100%': { transform: 'scale(2)', opacity: '0' },
        },
        particleBurst: {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '100%': { transform: 'scale(1.5)', opacity: '0' },
        },
        pageEnter: {
          '0%': { opacity: '0', transform: 'translateY(12px)', filter: 'blur(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        'dialog-content-in': {
          '0%': { opacity: '0', transform: 'translateY(16px)', filter: 'blur(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        'dialog-content-out': {
          '0%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
          '100%': { opacity: '0', transform: 'translateY(16px)', filter: 'blur(4px)' },
        },
        'dialog-overlay-in': {
          '0%': { opacity: '0', backdropFilter: 'blur(0)' },
          '100%': { opacity: '1', backdropFilter: 'blur(4px)' },
        },
        'dialog-overlay-out': {
          '0%': { opacity: '1', backdropFilter: 'blur(4px)' },
          '100%': { opacity: '0', backdropFilter: 'blur(0)' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
