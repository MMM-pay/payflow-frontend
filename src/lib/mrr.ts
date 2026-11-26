import type { ApiMandate } from "./api";

/**
 * Committed monthly recurring revenue (MRR) over time.
 *
 * The contract exposes a point value — the current monthly-normalised total of
 * active mandates — but no history. The indexer does not serve an MRR series
 * either (payflow-backend has no endpoint for it), so the trend is rebuilt on
 * the client from what the mandates themselves record: their price, billing
 * period, charge count and last charge.
 *
 * That makes the series an estimate, and the UI says so. What it must never do
 * is invent precision: the window a mandate was committed for is derived from
 * `last_charge - (charges_made - 1) * period`, which is exact only when the
 * subscriber has been charged on schedule since subscribing. A subscriber who
 * paused or missed a charge shifts their own start estimate; the note under the
 * chart tells the merchant that. Money stays a bigint throughout.
 */

/** A 30-day month, the convention `chainMerchantSummary` already uses for MRR. */
export const MONTH_SECONDS = 2_592_000;

/** Months of history the merchant dashboard shows. */
const MRR_WINDOW_MONTHS = 6;

export interface MrrPoint {
  /** Unix seconds at the start of the UTC month. */
  start: number;
  /** Monthly-normalised committed amount, in the token's smallest unit. */
  mrr: bigint;
  /** How many mandates contributed to this month. */
  mandates: number;
}

export interface MrrTrend {
  points: MrrPoint[];
  /** True when at least one mandate's start had to be inferred. */
  estimated: boolean;
}

interface MandateWindow {
  start: number;
  end: number;
  monthly: bigint;
  inferred: boolean;
}

function toAmount(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

function toPeriod(value: unknown): number | null {
  const period = typeof value === "string" ? Number(value) : value;
  return typeof period === "number" && Number.isFinite(period) && period > 0
    ? Math.round(period)
    : null;
}

/**
 * The monthly-normalised commitment of one mandate, floored to the smallest
 * unit. A weekly plan therefore counts as ~4.35× its price.
 *
 * Returns null when the amount or period cannot be read, so the caller can
 * tell "this mandate is unusable" from "this mandate is worth nothing".
 */
export function monthlyCommitment(
  amount: string | bigint,
  period: number,
): bigint | null {
  const raw = toAmount(amount);
  const seconds = toPeriod(period);
  if (raw === null || seconds === null) return null;
  return (raw * BigInt(MONTH_SECONDS)) / BigInt(seconds);
}

/** Unix seconds at the start of the UTC month containing `seconds`. */
export function monthStart(seconds: number): number {
  const date = new Date(Math.floor(seconds) * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
}

/** The start of the UTC month `months` away from `start`. */
export function shiftMonth(start: number, months: number): number {
  const date = new Date(start * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1) / 1000;
}

/** The last `months` month starts, oldest first, ending with the current month. */
export function monthStarts(now: number, months = MRR_WINDOW_MONTHS): number[] {
  const current = monthStart(now);
  return Array.from({ length: Math.max(1, months) }, (_, index) =>
    shiftMonth(current, index - (Math.max(1, months) - 1)),
  );
}

/**
 * The interval a mandate was committed for, or null when its terms are not
 * readable. A mandate counts from its first (estimated or known) charge and,
 * while active, through now.
 */
function mandateWindow(mandate: ApiMandate, now: number): MandateWindow | null {
  const monthly = monthlyCommitment(mandate.amount, mandate.period);
  if (monthly === null || monthly <= 0n) return null;

  const period = toPeriod(mandate.period)!;
  const lastCharge = Number(mandate.last_charge);
  const nextCharge = Number(mandate.next_charge);
  const chargesMade = Number(mandate.charges_made);
  let start: number;
  let inferred = false;

  if (chargesMade > 0 && Number.isFinite(lastCharge) && lastCharge > 0) {
    // The first charge is the observed lower bound of the commitment.
    start = lastCharge - Math.max(0, chargesMade - 1) * period;
  } else if (Number.isFinite(nextCharge) && nextCharge > 0) {
    // No charge yet: the next due date minus one period is the best estimate
    // of when the mandate started (the subscriber signed a period earlier).
    start = nextCharge - period;
    inferred = true;
  } else {
    start = now;
    inferred = true;
  }
  start = Math.max(0, Math.min(start, now));

  const active = mandate.status === "Active";
  const end = active
    ? now
    : Math.max(start, Number.isFinite(lastCharge) && lastCharge > 0 ? lastCharge : start);

  return { start, end, monthly, inferred };
}

/**
 * Build the committed-MRR series for the last `months` UTC months.
 *
 * Returns null when mandates exist but none of their terms can be read: an
 * empty chart in that case would read as "no recurring revenue". An empty
 * mandate list is a genuine zero series, which the caller renders as an empty
 * state rather than an error.
 */
export function buildMrrTrend(
  mandates: ApiMandate[],
  now = Math.floor(Date.now() / 1000),
  months = MRR_WINDOW_MONTHS,
): MrrTrend | null {
  const windows: MandateWindow[] = [];
  for (const mandate of mandates) {
    const window = mandateWindow(mandate, now);
    if (window) windows.push(window);
  }
  if (mandates.length > 0 && windows.length === 0) return null;

  const starts = monthStarts(now, months);
  const points = starts.map((start) => {
    const end = shiftMonth(start, 1);
    let mrr = 0n;
    let count = 0;
    for (const window of windows) {
      // A mandate committed at any point in the month counts for that month.
      if (window.start < end && window.end >= start) {
        mrr += window.monthly;
        count += 1;
      }
    }
    return { start, mrr, mandates: count };
  });

  return { points, estimated: windows.some((window) => window.inferred) };
}

/** The largest monthly commitment in the series, or 0n when it is empty. */
export function peakMrr(points: MrrPoint[]): bigint {
  return points.reduce((peak, point) => (point.mrr > peak ? point.mrr : peak), 0n);
}

/** The absolute and percentage change from one month to the next. */
export function mrrChange(
  current: bigint,
  previous: bigint,
): { delta: bigint; percent: number | null } {
  const delta = current - previous;
  // 100ths of a percent, taken in bigint so a large MRR never loses precision
  // before the display rounds it anyway.
  const percent =
    previous > 0n ? Number((delta * 10_000n) / previous) / 100 : null;
  return { delta, percent };
}

export interface MrrChartPoint {
  x: number;
  y: number;
}

/**
 * Pixel positions for the line. Like `scaleSeries`, the division is done in
 * bigint and only the final y is narrowed to a number.
 */
export function scaleMrrSeries(
  points: MrrPoint[],
  width: number,
  height: number,
  padding = 6,
): MrrChartPoint[] {
  if (points.length === 0) return [];
  const usable = Math.max(0, height - padding * 2);
  const max = peakMrr(points);

  return points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index * width) / (points.length - 1);
    if (max <= 0n) return { x, y: height - padding };
    const scaled = (point.mrr * BigInt(usable)) / max;
    const y = Math.min(
      height - padding,
      Math.max(padding, height - padding - Number(scaled)),
    );
    return { x, y };
  });
}
