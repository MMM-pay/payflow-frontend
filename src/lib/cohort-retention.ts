/**
 * One cohort in the retention grid: a signup month and how many subscribers
 * from that cohort remained active in each subsequent month.
 */
export interface CohortRetentionRow {
  /** Signup month in YYYY-MM format. */
  cohort: string;
  /** Number of subscribers who signed up in this month. */
  size: number;
  /**
   * Retention percentages for months 0, 1, 2, ... since signup.
   * Month 0 is the signup month itself (always 100%).
   * Each subsequent entry is the percentage still subscribed.
   */
  retention: number[];
}

/**
 * The full cohort retention analysis from the backend.
 */
export interface CohortRetentionData {
  merchant: string;
  cohorts: CohortRetentionRow[];
  /** The maximum age (in months) any cohort has been tracked. */
  maxAge: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMonth(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return year !== undefined && year > 0 && month !== undefined && month >= 1 && month <= 12;
}

function isValidPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function parseCohort(value: unknown): CohortRetentionRow | null {
  if (!isRecord(value)) return null;
  const { cohort, size, retention } = value;
  
  if (!isMonth(cohort)) return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return null;
  if (!Array.isArray(retention)) return null;
  
  // Validate all retention percentages
  for (const pct of retention) {
    if (!isValidPercentage(pct)) return null;
  }
  
  // Month 0 (signup month) should always be 100% if present
  if (retention.length > 0 && retention[0] !== 100) return null;
  
  return {
    cohort,
    size,
    retention: retention as number[],
  };
}

/**
 * Parse the backend's cohort retention response, or return null if it cannot
 * be safely represented.
 *
 * The backend returns cohorts (signup months) with their sizes and retention
 * percentages for each month since signup. We validate the structure and
 * ensure all percentages are in [0, 100] and that month 0 is always 100%.
 */
export function parseCohortRetention(
  body: unknown,
  merchant: string,
): CohortRetentionData | null {
  if (!isRecord(body) || body.merchant !== merchant || !Array.isArray(body.cohorts)) {
    return null;
  }

  const cohorts: CohortRetentionRow[] = [];
  const seen = new Set<string>();
  let maxAge = 0;

  for (const row of body.cohorts) {
    const cohort = parseCohort(row);
    if (cohort === null) return null;
    
    // No duplicate cohorts
    if (seen.has(cohort.cohort)) return null;
    seen.add(cohort.cohort);
    
    cohorts.push(cohort);
    maxAge = Math.max(maxAge, cohort.retention.length - 1);
  }

  // Sort chronologically (oldest first)
  cohorts.sort((a, b) => a.cohort.localeCompare(b.cohort));

  return {
    merchant,
    cohorts,
    maxAge,
  };
}

/**
 * Format a retention percentage for display.
 * Returns "100%" for perfect retention, "0%" for complete churn,
 * and removes unnecessary decimal places otherwise.
 */
export function formatRetentionPercent(value: number): string {
  if (value === 0) return "0%";
  if (value === 100) return "100%";
  // Show up to 1 decimal place, removing trailing zeros
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

/**
 * One sentence describing the grid, for readers who cannot see the tinted
 * cells.
 *
 * The grid encodes each figure twice — as a percentage and as a background
 * tint — and the tint is the half a screen reader cannot announce. The summary
 * says what the colours add up to: how many cohorts, how many subscribers they
 * cover, and the spread of month-1 retention. It is rendered both visibly
 * above the table and as the table's caption.
 *
 * `formatPercent` is injected so the summary reads in the same number format as
 * the cells it describes.
 */
export function describeCohortRetention(
  cohorts: readonly CohortRetentionRow[],
  formatPercent: (value: number) => string = formatRetentionPercent,
): string {
  const first = cohorts[0];
  const last = cohorts[cohorts.length - 1];
  if (!first || !last) return "No signup cohorts have been reported yet.";

  const subscribers = cohorts.reduce((total, row) => total + row.size, 0);
  const months =
    cohorts.length === 1
      ? `the ${first.cohort} signup month`
      : `signup months ${first.cohort} to ${last.cohort}`;
  const head =
    `Cohort retention for ${cohorts.length} ${cohorts.length === 1 ? "cohort" : "cohorts"} ` +
    `(${months}) covering ${subscribers} ${subscribers === 1 ? "subscriber" : "subscribers"}.`;

  // Month 0 is always 100% by construction, so month 1 is the first figure
  // that says anything about retention. A cohort too new to have one is left
  // out rather than counted as zero.
  const secondMonth = cohorts
    .map((row) => row.retention[1])
    .filter((value): value is number => value !== undefined);

  if (secondMonth.length === 0) {
    return `${head} No cohort is old enough to report a second month yet.`;
  }

  const lowest = Math.min(...secondMonth);
  const highest = Math.max(...secondMonth);
  return lowest === highest
    ? `${head} Month 1 retention is ${formatPercent(lowest)} across every cohort.`
    : `${head} Month 1 retention ranges from ${formatPercent(lowest)} to ${formatPercent(highest)}.`;
}

/**
 * The background tint for a retention cell, from the theme's own tokens.
 *
 * Five bands rather than a continuous scale: a reader has to be able to tell
 * "most of the cohort stayed" from "most of it left" at a glance, and five
 * steps is as many as a colour can carry without a legend.
 *
 * The tints are `accent`, `warn` and `danger` at 10–20% over the panel, never
 * fixed Tailwind palette colours: `dark:` variants follow the OS preference, so
 * a reader who chose the light theme on a dark system would get a dark tint
 * under dark text. Every band keeps the default `fg` text above WCAG AA, which
 * `test/contrast.test.ts` asserts at the token level.
 */
export function retentionColorClass(percent: number): string {
  if (percent >= 90) return "bg-accent/20";
  if (percent >= 70) return "bg-accent/10";
  if (percent >= 50) return "bg-warn/10";
  if (percent >= 30) return "bg-warn/20";
  if (percent > 0) return "bg-danger/10";
  return "bg-fg/5";
}
