/**
 * First-party performance telemetry: the pure half.
 *
 * The app ships no third-party analytics package. These helpers rate the Core
 * Web Vitals samples the idle-loaded client collects (`telemetry-client.ts`)
 * and decide where they may be sent. Keeping them free of DOM APIs means the
 * thresholds and payload shape are testable in node, and the browser bundle
 * only carries the short client module that imports this one.
 */

export type VitalName = "CLS" | "FCP" | "INP" | "LCP" | "TTFB";
export type VitalRating = "good" | "needs-improvement" | "poor";

interface VitalSample {
  name: VitalName;
  value: number;
  rating: VitalRating;
}

export interface TelemetryPayload {
  /** Pathname only: query strings can carry wallet addresses or plan ids. */
  page: string;
  at: number;
  metrics: VitalSample[];
}

/**
 * The Core Web Vitals thresholds published by web.dev. CLS is unitless; the
 * rest are milliseconds. `[good, needs-improvement]`: at or below the first
 * is good, at or below the second needs improvement, above it is poor.
 */
export const VITAL_THRESHOLDS: Readonly<Record<VitalName, readonly [number, number]>> = {
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  INP: [200, 500],
  LCP: [2500, 4000],
  TTFB: [800, 1800],
};

/** Rate one vital against the published thresholds. */
export function rateVital(name: VitalName, value: number): VitalRating {
  const [good, poor] = VITAL_THRESHOLDS[name];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

/**
 * Build a payload from whatever samples the page managed to collect.
 *
 * Non-finite and negative values are dropped rather than reported as zero:
 * a cancelled observer or a missing navigation entry should mean "unknown",
 * not a perfect score. CLS is rounded to three decimals and timings to whole
 * milliseconds, so the payload stays small and stable across browsers.
 */
export function buildTelemetryPayload(
  page: string,
  samples: ReadonlyArray<{ name: VitalName; value: number }>,
  at: number = Date.now(),
): TelemetryPayload {
  const metrics: VitalSample[] = [];
  for (const sample of samples) {
    if (!Number.isFinite(sample.value) || sample.value < 0) continue;
    const value = sample.name === "CLS" ? Math.round(sample.value * 1000) / 1000 : Math.round(sample.value);
    metrics.push({ name: sample.name, value, rating: rateVital(sample.name, value) });
  }
  return {
    // Strip any query/hash: only the route is useful, and the parameters can
    // contain addresses the user did not agree to send.
    page: page.split(/[?#]/, 1)[0] || "/",
    at,
    metrics,
  };
}

/**
 * Where telemetry may be posted. Unset means the feature is off, which is the
 * default: a self-hosted deployment that has not configured an endpoint must
 * not call out to anywhere. Only http(s) URLs are accepted.
 */
export function telemetryEndpoint(
  configured: string | undefined = process.env.NEXT_PUBLIC_TELEMETRY_URL,
): string | null {
  const value = configured?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Serialise a payload once, so a beacon and a fetch fallback send the same body. */
export function encodeTelemetry(payload: TelemetryPayload): string {
  return JSON.stringify(payload);
}
