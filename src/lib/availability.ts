/** Proposed payflow-contract#25/#26 fields. Missing values mean unsupported. */
export interface AvailabilityFields {
  available_until?: unknown;
  max_subscribers?: unknown;
  subscriber_count?: unknown;
}

/** Reject malformed API values rather than advertising invented seats/dates. */
export function availabilityInteger(raw: unknown): number | undefined {
  if (typeof raw !== "number" && typeof raw !== "bigint") return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

export function planAvailability(plan: AvailabilityFields, now = Math.floor(Date.now() / 1000)) {
  const cutoff = availabilityInteger(plan.available_until);
  const cap = availabilityInteger(plan.max_subscribers);
  const count = availabilityInteger(plan.subscriber_count);
  const until = cutoff && cutoff <= 8_640_000_000_000 ? cutoff : null;
  const seats = cap && count !== undefined ? Math.max(0, cap - count) : null;
  const reason = until !== null && now >= until
    ? "This plan is closed to new subscriptions."
    : seats === 0
      ? "This plan is full. No seats are available."
      : null;
  return { until, seats, reason, countUnavailable: Boolean(cap && count === undefined) };
}
