/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#08090c",
        panel: "rgba(18, 20, 28, 0.72)",
        ice: {
          50: "#e8f4fc",
          100: "#b8ddf5",
          200: "#88c6ee",
          300: "#58afe7",
          400: "#2898e0",
          500: "#1a7cc0",
          600: "#136098",
        },
      },
    },
  },
  plugins: [],
};
