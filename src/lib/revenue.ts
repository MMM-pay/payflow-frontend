import { formatDate } from "./format";

/**
 * Net revenue over time for the merchant dashboard.
 *
 * The endpoint this reads does not exist yet (payflow-backend#12 proposes
 * `GET /api/merchants/:address/revenue?bucket=day|week&from=&to=` returning
 * buckets with gross, fee and net as decimal strings), so nothing here can be
 * checked against a live server. Two consequences shaped the code:
 *
 * - The parser is tolerant about *shape* (a bucket may be named `bucket` or
 *   `start`, a date may be an ISO string or unix seconds) and strict about
 *   *values*. A shape it cannot read returns null, which the page turns into an
 *   explanation, rather than an empty chart that looks like "no revenue".
 * - Money is never a float. The API sends strings in the token's smallest unit
 *   and every total, sum and scale factor below stays a bigint. Converting to a
 *   Number to compute a pixel position is how a chart ends up disagreeing with
 *   the ledger by a stroop.
 */

export type BucketSize = "day" | "week";

const DAY = 86_400;
const WEEK = 7 * DAY;

/** One bucket as the API is expected to serve it. Every field is optional. */
export interface ApiRevenueBucket {
  /** ISO date (YYYY-MM-DD) or unix seconds marking the bucket's start. */
  bucket?: string | number;
  /** Accepted alias for `bucket`. */
  start?: string | number;
  /** Charge amounts before the protocol fee, smallest unit, decimal string. */
  gross?: string;
  /** The protocol's cut, smallest unit, decimal string. */
  fee?: string;
  /** What reached the merchant, smallest unit, decimal string. */
  net?: string;
}

export interface ApiRevenue {
  merchant?: string;
  bucket?: string;
  from?: number;
  to?: number;
  buckets?: ApiRevenueBucket[];
}

/** A parsed bucket. `start` is unix seconds at the start of the bucket, UTC. */
export interface RevenuePoint {
  start: number;
  gross: bigint;
  fee: bigint;
  net: bigint;
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isFinite(value) ? BigInt(Math.trunc(value)) : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

/**
 * The bucket's start as unix seconds, from an ISO date or a number.
 *
 * Parsed as UTC midnight explicitly: `new Date("2026-10-12")` is already UTC,
 * but a bare unix value is not, and mixing the two would shift a daily series
 * by a day for readers outside UTC.
 */
function toStartSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const ms = Date.parse(trimmed.length <= 10 ? `${trimmed}T00:00:00Z` : trimmed);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Parse an API body into a sorted series, or null when it is not readable.
 *
 * Null is the fail-soft answer, and it is deliberately distinct from `[]`:
 * an empty array means "this merchant earned nothing", which is a real answer
 * worth charting as a flat line, while null means "this backend does not serve
 * the endpoint" and must be explained on the page rather than drawn.
 */
export function parseRevenue(body: unknown): RevenuePoint[] | null {
  if (!body || typeof body !== "object") return null;
  const rows = (body as ApiRevenue).buckets;
  if (!Array.isArray(rows)) return null;

  const points: RevenuePoint[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const start = toStartSeconds(row.bucket ?? row.start);
    const gross = toBigInt(row.gross);
    const fee = toBigInt(row.fee);
    const net = toBigInt(row.net);
    // A bucket missing any figure cannot be drawn honestly: scaling it as zero
    // would read as "nothing earned that day" when the truth is "unknown".
    if (start === null || gross === null || fee === null || net === null) continue;
    points.push({ start, gross, fee, net });
  }

  points.sort((a, b) => a.start - b.start);
  return points;
}

/** The size of one bucket in seconds. */
export function bucketSeconds(size: BucketSize): number {
  return size === "week" ? WEEK : DAY;
}

/** The start of the bucket containing `unixSeconds`, floored to UTC midnight. */
export function floorToBucket(unixSeconds: number, size: BucketSize): number {
  const dayStart = Math.floor(unixSeconds / DAY) * DAY;
  return size === "week" ? Math.floor(dayStart / WEEK) * WEEK : dayStart;
}

/**
 * Insert the buckets the API left out.
 *
 * The gap between "1 Oct" and "9 Oct" with nothing earned has to be an actual
 * point on the line, or the chart draws a straight segment across the quiet
 * stretch and reports four weeks of revenue as a steady trend. Every inserted
 * bucket is a genuine zero.
 */
export function fillBuckets(
  points: RevenuePoint[],
  size: BucketSize,
  from: number,
  to: number,
): RevenuePoint[] {
  if (points.length === 0) return [];
  const step = bucketSeconds(size);
  const first = floorToBucket(Math.min(from, points[0]?.start ?? from), size);
  const last = floorToBucket(Math.max(to, points[points.length - 1]?.start ?? to), size);

  const byStart = new Map<number, RevenuePoint>();
  for (const p of points) byStart.set(floorToBucket(p.start, size), p);

  const series: RevenuePoint[] = [];
  for (let t = first; t <= last; t += step) {
    series.push(byStart.get(t) ?? { start: t, gross: 0n, fee: 0n, net: 0n });
  }
  return series;
}

/** Total net revenue across the series. */
export function totalNet(points: RevenuePoint[]): bigint {
  return points.reduce((sum, p) => sum + p.net, 0n);
}

/** The largest net value in the series, or 0 when it is empty. */
export function peakNet(points: RevenuePoint[]): bigint {
  return points.reduce((peak, p) => (p.net > peak ? p.net : peak), 0n);
}

/** The bucket with the highest net, or null when the series is empty. */
export function bestPoint(points: RevenuePoint[]): RevenuePoint | null {
  let best: RevenuePoint | null = null;
  for (const p of points) {
    if (best === null || p.net > best.net) best = p;
  }
  return best;
}

export interface ChartPoint {
  x: number;
  y: number;
}

/**
 * Turn a series into pixel coordinates.
 *
 * The division is done in bigint and only the final y is narrowed to a number:
 * `(value * height) / max` in floating point loses the distinction between two
 * adjacent stroops on a large total, which is the same class of bug as
 * rounding a price — it just shows up as a bar one pixel off.
 */
export function scaleSeries(
  points: RevenuePoint[],
  width: number,
  height: number,
  padding = 4,
): ChartPoint[] {
  if (points.length === 0) return [];
  const usable = Math.max(0, height - padding * 2);
  const max = peakNet(points);

  return points.map((p, i) => {
    const x = points.length === 1 ? width / 2 : (i * width) / (points.length - 1);
    let y: number;
    if (max <= 0n) {
      // An all-zero series is still a series: draw it along the floor rather
      // than dividing by zero or collapsing it to a single point.
      y = height - padding;
    } else {
      const scaled = (p.net * BigInt(usable)) / max;
      // Clamp so a negative bucket (a refund or a fee adjustment) cannot draw
      // outside the frame.
      y = height - padding - Number(scaled);
      y = Math.min(height - padding, Math.max(padding, y));
    }
    return { x, y };
  });
}

/** An SVG polyline `points` attribute from scaled coordinates. */
export function toPolyline(points: ChartPoint[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "12 Nov" on an axis; "10 Nov" for a week, with the week named in its title. */
export function formatBucketLabel(start: number): string {
  const full = formatDate(start);
  return full.split(" ").slice(0, 2).join(" ");
}

/** The `title` for a bucket cell: names the week explicitly where it matters. */
export function bucketTitle(start: number, size: BucketSize): string {
  return size === "week"
    ? `Week of ${formatDate(start)}`
    : `${formatDate(start)}`;
}

/**
 * One sentence describing the series, for the chart's accessible name.
 *
 * A chart's shape is unavailable to anyone using a screen reader, so the
 * summary carries what the picture says: the range, the total, and the peak.
 */
export function describeSeries(
  points: RevenuePoint[],
  size: BucketSize,
  render: (value: bigint) => string,
): string {
  if (points.length === 0) return "No revenue recorded in this period.";
  const first = points[0]?.start ?? 0;
  const last = points[points.length - 1]?.start ?? 0;
  const unit = size === "week" ? "week" : "day";
  const range = `from ${formatDate(first)} to ${formatDate(last)}`;
  const total = `total ${render(totalNet(points))}`;
  const best = bestPoint(points);
  const peak =
    best && best.net > 0n
      ? `peak ${render(best.net)} in the ${unit} of ${formatDate(best.start)}`
      : "";
  return `Net revenue by ${unit}, ${range}, ${total}${peak ? `, ${peak}` : ""}.`;
}