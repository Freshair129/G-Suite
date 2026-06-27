/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0a0c10",
        surface: {
          DEFAULT: "#13161c",
          raised: "#1a1e26",
          hover: "#232834",
        },
        line: "rgba(255,255,255,0.07)",
        mint: {
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
        },
        ice: {
          300: "#7cc4f0",
          400: "#58afe7",
          500: "#2898e0",
        },
        ink: {
          DEFAULT: "#e8edf3",
          muted: "#8b94a3",
          faint: "#5b6472",
        },
        danger: "#f87171",
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
        glow: "0 0 0 1px rgba(52,211,153,0.4), 0 0 24px -4px rgba(52,211,153,0.35)",
      },
    },
  },
  plugins: [],
};
