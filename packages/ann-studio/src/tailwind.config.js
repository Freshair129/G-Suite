/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0d0d0d",
        panel: {
          DEFAULT: "#1c1c1e",
          hover: "#2a2a2d",
        },
        line: "rgba(255,255,255,0.1)",
        lime: {
          DEFAULT: "#e0ff00",
          dim: "#b9d400",
        },
        grass: "#22c55e",
        ink: {
          DEFAULT: "#ffffff",
          muted: "#9ca3af",
          faint: "#6b7280",
        },
        danger: "#f87171",
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(224,255,0,0.35), 0 0 24px -6px rgba(224,255,0,0.4)",
      },
    },
  },
  plugins: [],
};
