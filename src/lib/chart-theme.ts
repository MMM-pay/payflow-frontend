/**
 * Theme-aware chart palette.
 *
 * Charts must follow the active theme, including a manual light/dark choice on
 * the opposite OS setting. Tailwind's `dark:` variants only see the OS
 * preference, so chart colours go through the `--chart-*` tokens in
 * `globals.css`, which both the media query and `data-theme` selectors set.
 *
 * The palette is categorical rather than semantic: callers pick a slot for a
 * series, and the same slot keeps its meaning when the theme changes. Every
 * entry has at least 3:1 non-text contrast against the panel in both themes.
 */
export const CHART_PALETTE_SIZE = 5;

/** CSS custom properties, in a stable series order. */
export const CHART_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/**
 * A colour for a series slot. Slots wrap, so a caller cannot produce an
 * `undefined` colour by passing a larger index than the palette.
 */
export function chartColor(index: number): string {
  const slot = ((Math.trunc(index) % CHART_PALETTE_SIZE) + CHART_PALETTE_SIZE) % CHART_PALETTE_SIZE;
  return CHART_PALETTE[slot] ?? CHART_PALETTE[0];
}

/**
 * Tailwind classes for a filled chart mark, e.g. a cohort retention cell.
 *
 * The class strings are written out rather than interpolated so Tailwind's
 * scanner can see and emit them.
 */
export const CHART_FILL_CLASSES = [
  "bg-chart-1/15 text-chart-1",
  "bg-chart-2/15 text-chart-2",
  "bg-chart-3/15 text-chart-3",
  "bg-chart-4/15 text-chart-4",
  "bg-chart-5/15 text-chart-5",
] as const;

export function chartFillClass(index: number): string {
  const slot = ((Math.trunc(index) % CHART_PALETTE_SIZE) + CHART_PALETTE_SIZE) % CHART_PALETTE_SIZE;
  return CHART_FILL_CLASSES[slot] ?? CHART_FILL_CLASSES[0];
}
