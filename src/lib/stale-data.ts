/**
 * Staleness detection for backend projections.
 *
 * The merchant dashboard and subscriber portal read balances, mandates and
 * revenue from the indexer. Those figures are projections of on-chain state:
 * when the indexer falls behind, the page keeps showing the last numbers it
 * received, which can be wrong. Rather than silently presenting them as
 * current, the UI measures how old they are and asks the reader to refresh.
 *
 * The age comes from two independent sources:
 *
 * - `fetchedAt`: when this page last received a projection.
 * - `freshnessSeconds`: how far behind the backend says its own projection is.
 *
 * Whichever is larger wins. A page that just fetched a projection the backend
 * already knew was an hour old is still an hour stale.
 */

/** Five minutes: long enough not to nag, short enough to catch a lagging indexer. */
export const DEFAULT_STALE_AFTER_MS = 5 * 60_000;

type StaleDataState = "loading" | "empty" | "error" | "fresh" | "stale";

export interface StaleDataInput {
  /** When the displayed projection was received, in ms since the epoch. */
  fetchedAt: number | null;
  /** Current time in ms since the epoch. */
  now: number;
  /** How old data may be before it counts as stale. */
  staleAfterMs?: number;
  /** Backend-reported age of its projection, in seconds. */
  freshnessSeconds?: number | null;
  /** A refresh is in flight. */
  loading?: boolean;
  /** The last refresh failed. */
  error?: string | null;
}

export interface StaleDataEvaluation {
  state: StaleDataState;
  /** Whether the numbers on screen may be out of date. */
  isStale: boolean;
  /** Age of the last local fetch, in ms, or null when nothing was fetched. */
  ageMs: number | null;
  /** Age implied by the backend's own freshness report, in ms. */
  projectionAgeMs: number | null;
  /** The effective age used for the decision, in ms. */
  effectiveAgeMs: number | null;
  /** The threshold that produced this decision. */
  staleAfterMs: number;
}

function normaliseThreshold(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_STALE_AFTER_MS;
}

function ageFromFreshness(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1000)
    : null;
}

/**
 * Classify the projection behind a set of figures.
 *
 * Errors win over staleness, because a failed refresh is actionable even when
 * the last data is still recent. A first load with no data is `empty` (or
 * `loading` while in flight); with data, a refresh in flight keeps the stale
 * classification so the warning does not disappear mid-refresh.
 */
export function evaluateStaleData(input: StaleDataInput): StaleDataEvaluation {
  const staleAfterMs = normaliseThreshold(input.staleAfterMs);
  const ageMs =
    input.fetchedAt === null ? null : Math.max(0, input.now - input.fetchedAt);
  const projectionAgeMs = ageFromFreshness(input.freshnessSeconds);
  const knownAges = [ageMs, projectionAgeMs].filter(
    (age): age is number => age !== null,
  );
  const effectiveAgeMs =
    knownAges.length > 0 ? Math.max(...knownAges) : null;

  const base = {
    ageMs,
    projectionAgeMs,
    effectiveAgeMs,
    staleAfterMs,
  } as const;

  if (input.error) {
    return { ...base, state: "error", isStale: true };
  }

  if (effectiveAgeMs === null) {
    return {
      ...base,
      state: input.loading ? "loading" : "empty",
      isStale: false,
    };
  }

  const isStale = effectiveAgeMs > staleAfterMs;
  return {
    ...base,
    state: isStale ? "stale" : "fresh",
    isStale,
  };
}
