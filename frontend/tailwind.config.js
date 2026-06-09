/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Override white so every text-white / bg-white adapts to the active theme.
        // Elements that must stay truly white use bg-[#ffffff] or text-[#ffffff].
        white: "rgb(var(--fg) / <alpha-value>)",

        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          raised:  "rgb(var(--surface-raised) / <alpha-value>)",
          hover:   "rgb(var(--surface-hover) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--bd) / <alpha-value>)",
          strong:  "rgb(var(--bd-strong) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          light:   "rgb(var(--accent-light) / <alpha-value>)",
          dim:     "rgb(var(--accent) / 0.13)",
        },
        muted:    "rgb(var(--fg-muted) / <alpha-value>)",
        positive: "rgb(var(--positive) / <alpha-value>)",
        negative: "rgb(var(--negative) / <alpha-value>)",

        // layout backgrounds
        sidebar: "rgb(var(--sidebar) / <alpha-value>)",
        bg:      "rgb(var(--bg) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
