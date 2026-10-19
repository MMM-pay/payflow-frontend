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

export function formatWhen(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  const delta = unixSeconds * 1000 - Date.now();
  const abs = Math.abs(delta);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return delta >= 0 ? "due now" : "just now";
  if (mins < 60) return delta >= 0 ? `in ${mins}m` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return delta >= 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return delta >= 0 ? `in ${days}d` : `${days}d ago`;
}
