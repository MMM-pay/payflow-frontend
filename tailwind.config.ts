import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

/**
 * Tailwind 3 has logical text/border/radius utilities but not logical spacing
 * or inset ones. These four pairs keep existing LTR pixels identical while
 * mirroring under `dir="rtl"` (which the i18n provider sets for Arabic).
 */
const logicalSpacing = plugin(({ matchUtilities, theme }) => {
  // `auto` and `full` are margin/inset values, not spacing values, but the
  // existing code uses `ml-auto`, so the logical alias needs them too.
  const values = { ...(theme("spacing") as Record<string, string>), auto: "auto", full: "100%" };
  matchUtilities(
    {
      ps: (value) => ({ paddingInlineStart: value }),
      pe: (value) => ({ paddingInlineEnd: value }),
      ms: (value) => ({ marginInlineStart: value }),
      me: (value) => ({ marginInlineEnd: value }),
    },
    { values, supportsNegativeValues: true },
  );
  matchUtilities(
    {
      start: (value) => ({ insetInlineStart: value }),
      end: (value) => ({ insetInlineEnd: value }),
    },
    { values, supportsNegativeValues: true },
  );
});

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
        /** Categorical chart palette; swaps with the active theme. */
        "chart-1": "rgb(var(--chart-1) / <alpha-value>)",
        "chart-2": "rgb(var(--chart-2) / <alpha-value>)",
        "chart-3": "rgb(var(--chart-3) / <alpha-value>)",
        "chart-4": "rgb(var(--chart-4) / <alpha-value>)",
        "chart-5": "rgb(var(--chart-5) / <alpha-value>)",
      },
    },
  },
  plugins: [logicalSpacing],
} satisfies Config;
