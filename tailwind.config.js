/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // shadcn/ui variable-driven palette (dark values set in index.css)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },

        // ── PulseStock design tokens (design.md §2) ──────────────────────
        abyss: "#0A0E13", // app background
        surface: "#10161E", // sidebar, topbar, page bands
        panel: "#151D27", // cards, panels, tables (bg-card)
        "panel-hover": "#1A2430",
        inset: "#0C1118", // chart plot areas, inputs, wells
        hairline: "#232E3B",
        bright: "#33414F", // hover borders, focus ring base
        "text-primary": "#E9EFF5",
        "text-secondary": "#93A1B0",
        "text-muted": "#5B6875",

        lime: {
          DEFAULT: "#C6F04D",
          dim: "rgba(198,240,77,0.12)",
        },
        cyan: {
          DEFAULT: "#3EE6D8",
        },

        // Stage spectrum (lifecycle)
        stage: {
          intake: "#8B7CFF",
          seeding: "#45B7F5",
          eval: "#3EE6D8",
          scaling: "#4ADE80",
          live: "#A3D65C",
          risk: "#FBBF24",
          declining: "#FB923C",
          dead: "#8A95A1",
        },

        // Decision badge colors
        decision: {
          scale: "#4ADE80",
          keep: "#45B7F5",
          kill: "#FB5D7A",
          stop: "#FBBF24",
          deadstock: "#B9C2CC",
          onboarding: "#8B7CFF",
        },

        // Data semantics
        pos: "#4ADE80",
        neg: "#FB5D7A",
        neutral: "#93A1B0",
        amber: "#FBBF24",
        rose: "#FB5D7A",
        orange: "#FB923C",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "glow-lime": "0 0 0 1px rgba(198,240,77,0.25), 0 0 24px rgba(198,240,77,0.08)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
        "pulse-dot": {
          "0%": { boxShadow: "0 0 0 0 rgba(251,191,36,0.45)" },
          "70%": { boxShadow: "0 0 0 6px rgba(251,191,36,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(251,191,36,0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        "pulse-dot": "pulse-dot 2s ease-out infinite",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
