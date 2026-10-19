/** XLM and most SEP-41 tokens use 7 decimal places. */
export const DECIMALS = 7;

/** The scaling, symbol and decimals of the token an amount is denominated in. */
export interface TokenMeta {
  symbol: string;
  decimals: number;
}

/**
 * Native XLM. Also the fallback for any token whose contract metadata cannot
 * be read, so the UI still shows something sensible rather than a blank unit.
 */
export const XLM: TokenMeta = { symbol: "XLM", decimals: DECIMALS };

/**
 * SEP-41 `decimals` is a u32 a token can set to anything, including values that
 * would make `10n ** decimals` enormous. Clamp to the range `u32` money can
 * realistically use so one bad token cannot hang the page.
 */
const MIN_DECIMALS = 0;
const MAX_DECIMALS = 18;

function normalizeDecimals(decimals: number): number {
  if (!Number.isFinite(decimals)) return DECIMALS;
  return Math.min(MAX_DECIMALS, Math.max(MIN_DECIMALS, Math.trunc(decimals)));
}

/** Convert a smallest-unit string ("9900000") to a display string ("0.99"). */
export function fromStroops(
  raw: string | bigint,
  maxFractionDigits = 4,
  decimals = DECIMALS,
): string {
  let value: bigint;
  try {
    value = typeof raw === "bigint" ? raw : BigInt(raw || "0");
  } catch {
    return "0";
  }
  const places = normalizeDecimals(decimals);
  const scale = 10n ** BigInt(places);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / scale;
  const frac = abs % scale;

  let fracStr = frac.toString().padStart(places, "0").slice(0, maxFractionDigits);
  fracStr = fracStr.replace(/0+$/, "");

  const body = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return negative ? `-${body}` : body;
}

/** Convert a user-typed decimal amount to smallest units. Throws on garbage. */
export function toStroops(input: string, decimals = DECIMALS): bigint {
  const places = normalizeDecimals(decimals);
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Enter a positive number, for example 2.5");
  }
  const [whole = "0", frac = ""] = trimmed.split(".");
  if (frac.length > places) {
    throw new Error(`At most ${places} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(places) + BigInt(frac.padEnd(places, "0") || "0");
}

/**
 * A smallest-unit amount rendered with its own token's unit, e.g. "0.99 USDC".
 * Every amount on screen goes through this so no page can end up labelling an
 * amount with a token it is not denominated in.
 */
export function formatAmount(
  raw: string | bigint,
  meta: TokenMeta = XLM,
  maxFractionDigits = 4,
): string {
  return `${fromStroops(raw, maxFractionDigits, meta.decimals)} ${meta.symbol}`;
}

const PERIODS: Array<[string, number]> = [
  ["minute", 60],
  ["hour", 3_600],
  ["day", 86_400],
  ["week", 604_800],
  ["month", 2_592_000],
  ["year", 31_536_000],
];

export function formatPeriod(seconds: number): string {
  for (let i = PERIODS.length - 1; i >= 0; i -= 1) {
    const entry = PERIODS[i];
    if (!entry) continue;
    const [label, size] = entry;
    if (seconds >= size && seconds % size === 0) {
      const n = seconds / size;
      return n === 1 ? `per ${label}` : `every ${n} ${label}s`;
    }
  }
  return `every ${seconds}s`;
}

export function shortAddress(address: string, size = 4): string {
  if (address.length <= size * 2 + 3) return address;
  return `${address.slice(0, size)}…${address.slice(-size)}`;
}

function relativePhrase(count: number, unit: string, future: boolean): string {
  const text = count === 1 ? `1 ${unit}` : `${count} ${unit}s`;
  return future ? `in ${text}` : `${text} ago`;
}

/**
 * A timestamp as plain-language relative time: "in 3 days", "2 hours ago".
 * The old "in 3d" form is hard to read at a glance; the exact local time
 * belongs in the tooltip, which `TimeAgo` in `src/components/ui.tsx` renders
 * alongside this. `nowMs` exists so tests can pin the clock.
 */
export function formatWhen(unixSeconds: number, nowMs = Date.now()): string {
  if (!unixSeconds) return "—";
  const delta = unixSeconds * 1000 - nowMs;
  const abs = Math.abs(delta);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return delta >= 0 ? "due now" : "just now";
  if (mins < 60) return relativePhrase(mins, "minute", delta >= 0);
  const hours = Math.round(mins / 60);
  if (hours < 24) return relativePhrase(hours, "hour", delta >= 0);
  const days = Math.round(hours / 24);
  return relativePhrase(days, "day", delta >= 0);
}

/**
 * The same instant at its exact local time, e.g. "19 Oct 2026, 14:05", for
 * the tooltip that accompanies a relative time.
 */
export function formatExactTime(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The `.`-decimal canonical form of a user-typed amount, or `null` when the
 * input is not a single number.
 *
 * Users type the separators their own locale uses: "1,234.5" (dot decimal,
 * comma grouping), "1.234,5" (comma decimal, dot grouping), or just "1,5".
 * The last separator is the decimal mark unless the whole input matches the
 * thousands-grouping pattern, so "1,234" and "1.234.567" are whole grouped
 * numbers — the same disambiguation spreadsheet and banking software use.
 * Earlier separators must then be valid grouping ("1.2.3" is rejected).
 */
export function canonicalAmount(input: string): string | null {
  const stripped = input.replace(/[\s\u00a0\u202f]/g, "");
  if (!stripped || !/^[\d.,]+$/.test(stripped)) return null;

  // "1,234" / "1.234.567": every separator groups thousands, none is decimal.
  if (/^\d{1,3}([.,]\d{3})+$/.test(stripped)) {
    return stripped.replace(/[.,]/g, "");
  }

  const last = Math.max(stripped.lastIndexOf("."), stripped.lastIndexOf(","));
  if (last === -1) return stripped;
  const head = stripped.slice(0, last);
  const tail = stripped.slice(last + 1);
  // The part before the decimal mark may only group thousands.
  if (!/^(?:\d{1,3}(?:[.,]\d{3})*|\d+)?$/.test(head) || !/^\d*$/.test(tail)) {
    return null;
  }
  return `${head.replace(/[.,]/g, "") || "0"}.${tail}`;
}

/**
 * Locale-aware sibling of `toStroops`: accepts the separators the user's
 * locale uses and normalises them before the strict parser runs, so
 * "1.234,5" and "1,234.5" both convert to the same bigint. Amounts must stay
 * bigint end to end — no step here touches `Number`.
 */
export function parseAmount(input: string, decimals = DECIMALS): bigint {
  const canonical = canonicalAmount(input);
  if (canonical === null) {
    throw new Error("Enter a positive number, for example 2.5");
  }
  return toStroops(canonical, decimals);
}

/**
 * Restrict what an amount field displays: digits, at most one decimal mark
 * (either character — users type what their keyboard has), and a fraction
 * no longer than the token's decimals. Grouping separators typed before the
 * last mark are kept verbatim so "1,234." stays "1,234." while the user
 * keeps typing. Exported for `AmountInput` and its tests.
 */
export function normaliseAmountInput(raw: string, decimals = DECIMALS): string {
  const stripped = raw.replace(/[\s\u00a0\u202f]/g, "");
  const places = normalizeDecimals(decimals);
  const last = Math.max(stripped.lastIndexOf("."), stripped.lastIndexOf(","));
  if (last === -1) return stripped.replace(/\D/g, "");
  const head = stripped.slice(0, last).replace(/[^\d.,]/g, "");
  // A whole-number token takes no fraction: drop the mark and what follows
  // rather than joining the digits into a different (larger) number.
  if (places === 0) return head;
  const mark = stripped[last];
  const frac = stripped
    .slice(last + 1)
    .replace(/\D/g, "")
    .slice(0, places);
  return frac ? `${head}${mark}${frac}` : `${head}${mark}`;
}

/**
 * Why an amount field cannot be submitted, or `null` when it can — including
 * when it is empty or the user is mid-keystroke on a trailing separator.
 */
export function amountError(input: string, decimals = DECIMALS): string | null {
  const stripped = input.replace(/[\s\u00a0\u202f]/g, "");
  if (!stripped) return null;
  // A bare trailing separator ("12.", ",") is someone still typing, not a
  // mistake yet; anything else must parse cleanly before the form submits.
  if (/^\d+[.,]$|^[.,]$/.test(stripped)) return null;
  try {
    parseAmount(stripped, decimals);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
