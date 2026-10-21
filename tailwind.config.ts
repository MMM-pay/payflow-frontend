import type { Config } from "tailwindcss";

/**
 * Colours are CSS custom properties rather than fixed hex values so the light
 * and dark palettes can swap at runtime (see `globals.css`). The
 * `<alpha-value>` placeholder keeps opacity modifiers such as `bg-accent/15`
 * and `text-muted/60` working in both themes.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--ink) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        edge: "rgb(var(--edge) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        /** Primary body text. */
        fg: "rgb(var(--fg) / <alpha-value>)",
        /** Secondary text that still needs to read as text, not a hint. */
        soft: "rgb(var(--soft) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        /** Solid destructive button: dark enough for white text in both themes. */
        "danger-solid": "rgb(var(--danger-solid) / <alpha-value>)",
        "danger-solid-hover": "rgb(var(--danger-solid-hover) / <alpha-value>)",
      },
    },
  },
  plugins: [],
} satisfies Config;
