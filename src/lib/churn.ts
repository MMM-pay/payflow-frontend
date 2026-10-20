/** One monthly merchant churn bucket, normalized from the backend response. */
export interface MerchantChurnMonth {
  bucket: string;
  started: number;
  cancelled: number;
  ended: number;
  completed: number;
  net: number;
}

interface ChurnCounts {
  started: number;
  cancelled: number;
  ended: number;
  completed: number;
  net: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isMonth(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return year !== undefined && year > 0 && month !== undefined && month >= 1 && month <= 12;
}

function parseCounts(value: unknown): ChurnCounts | null {
  if (!isRecord(value)) return null;
  const { started, cancelled, ended, completed, net } = value;
  if (
    !isSafeInteger(started) ||
    !isSafeInteger(cancelled) ||
    !isSafeInteger(ended) ||
    !isSafeInteger(completed) ||
    !isSafeInteger(net) ||
    started < 0 ||
    cancelled < 0 ||
    ended < 0 ||
    completed < 0
  ) {
    return null;
  }
  if (
    BigInt(started) - BigInt(cancelled) - BigInt(ended) - BigInt(completed) !== BigInt(net)
  ) {
    return null;
  }
  return {
    started,
    cancelled,
    ended,
    completed,
    net,
  };
}

/**
 * Parse the backend's monthly churn response, or return null if it cannot be
 * safely represented. Missing months stay missing; the API only reports the
 * event buckets it actually queried, so filling gaps here could imply data
 * that the response did not provide.
 */
export function parseMerchantChurn(
  body: unknown,
  merchant: string,
): MerchantChurnMonth[] | null {
  if (
    !isRecord(body) ||
    body.merchant !== merchant ||
    body.bucket !== "month" ||
    !Array.isArray(body.buckets)
  ) {
    return null;
  }

  const totals = parseCounts(body.totals);
  if (totals === null) return null;

  const months: MerchantChurnMonth[] = [];
  const seen = new Set<string>();
  for (const row of body.buckets) {
    if (!isRecord(row) || !isMonth(row.bucket) || seen.has(row.bucket)) return null;
    const counts = parseCounts(row);
    if (counts === null) return null;
    seen.add(row.bucket);
    months.push({ bucket: row.bucket, ...counts });
  }

  months.sort((a, b) => a.bucket.localeCompare(b.bucket));
  const sums = months.reduce(
    (sum, month) => ({
      started: sum.started + BigInt(month.started),
      cancelled: sum.cancelled + BigInt(month.cancelled),
      ended: sum.ended + BigInt(month.ended),
      completed: sum.completed + BigInt(month.completed),
      net: sum.net + BigInt(month.net),
    }),
    { started: 0n, cancelled: 0n, ended: 0n, completed: 0n, net: 0n },
  );
  if (
    sums.started !== BigInt(totals.started) ||
    sums.cancelled !== BigInt(totals.cancelled) ||
    sums.ended !== BigInt(totals.ended) ||
    sums.completed !== BigInt(totals.completed) ||
    sums.net !== BigInt(totals.net)
  ) {
    return null;
  }

  return months;
}
