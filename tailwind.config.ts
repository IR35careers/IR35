import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#18a56f",
          600: "#087a5b",
          700: "#096048",
          800: "#064e3b",
          900: "#063c2f",
          950: "#022c22",
        },
        status: {
          outside: "#15803d",
          inside: "#be123c",
          tbc: "#8a5a12",
          info: "#1d4ed8",
          danger: "#b42318",
        },
        primary: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
        accent: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
          950: "#042f2e",
        },
        surface: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        display: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      fontSize: {
        "display-xl": [
          "4.5rem",
          { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "700" },
        ],
        "display-lg": [
          "3.75rem",
          { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "700" },
        ],
        "display-md": [
          "3rem",
          { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "700" },
        ],
        "display-sm": [
          "2.25rem",
          { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
      },
      borderRadius: {
        "4xl": "2rem",
        "5xl": "2.5rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(11, 18, 32, 0.04), 0 12px 32px -24px rgba(11, 18, 32, 0.28)",
        floating: "0 24px 70px -30px rgba(11, 18, 32, 0.38)",
        glow: "0 0 40px -8px rgba(99, 102, 241, 0.3)",
        "glow-lg": "0 0 80px -12px rgba(99, 102, 241, 0.4)",
        "glow-accent": "0 0 40px -8px rgba(20, 184, 166, 0.3)",
        soft: "0 2px 16px -4px rgba(15, 23, 42, 0.08)",
        "soft-lg": "0 8px 32px -8px rgba(15, 23, 42, 0.12)",
        glass:
          "0 8px 32px -8px rgba(15, 23, 42, 0.08), inset 0 1px 0 0 rgba(255,255,255,0.6)",
        "glass-dark":
          "0 8px 32px -8px rgba(0, 0, 0, 0.4), inset 0 1px 0 0 rgba(255,255,255,0.08)",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(var(--tw-gradient-stops))",
        "gradient-mesh":
          "radial-gradient(at 20% 30%, rgba(99, 102, 241, 0.08) 0, transparent 50%), radial-gradient(at 80% 20%, rgba(20, 184, 166, 0.08) 0, transparent 50%), radial-gradient(at 50% 80%, rgba(168, 85, 247, 0.06) 0, transparent 50%)",
      },
      animation: {
        "fade-in": "fade-in 200ms cubic-bezier(0.2, 0, 0, 1) both",
        "slide-down": "slide-down 220ms cubic-bezier(0.2, 0, 0, 1) both",
        float: "float 6s ease-in-out infinite",
        "float-slow": "float 8s ease-in-out infinite",
        "float-delayed": "float 7s ease-in-out 1s infinite",
        pulse: "pulse-glow 3s ease-in-out infinite",
        shimmer: "shimmer 3s linear infinite",
        "spin-slow": "spin 12s linear infinite",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-12px)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
