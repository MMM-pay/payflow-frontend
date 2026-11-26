/**
 * Where a past-due mandate stands in its grace period.
 *
 * A mandate goes past due when its vault cannot cover a charge, and the
 * contract keeps it alive until `past_due_until` (payflow-contract#34). The
 * subscriber has to top up before then, so the portal badges the window and
 * says how long is left. A contract that does not report the end, or a
 * mandate that is not past due, has no window to show.
 */

/** Inside this many seconds of the end, the badge switches to the urgent tone. */
export const GRACE_URGENT_SECONDS = 24 * 60 * 60;

export type GraceState =
  | { kind: "none" }
  | { kind: "open"; until: number; urgent: boolean }
  | { kind: "ended"; until: number };

/**
 * `until` is the grace period's end in Unix seconds, or null when unknown.
 * `nowMs` is injectable so a page and its tests agree on the reference time.
 */
export function graceState(until: number | null, nowMs: number = Date.now()): GraceState {
  if (until === null || !Number.isFinite(until) || until <= 0) return { kind: "none" };
  const left = until - Math.floor(nowMs / 1000);
  if (left <= 0) return { kind: "ended", until };
  return { kind: "open", until, urgent: left <= GRACE_URGENT_SECONDS };
}
