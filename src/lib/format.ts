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

/**
 * What a form should say about the amount a merchant typed.
 *
 * `toStroops` throws, which is the right behaviour for a transaction path and
 * the wrong one for a live form: a half-typed "1." must read as "keep going",
 * not as a failure. This returns the reason instead so the field can disable
 * the submit button and explain itself without a round trip through an
 * exception.
 */
export type AmountCheck =
  | { ok: true; stroops: bigint }
  | { ok: false; message: string };

/**
 * Validate a user-typed amount without throwing.
 *
 * Accepts a partially typed number such as "1." — the trailing dot is what a
 * numeric keypad leaves behind mid-entry — but rejects anything that could not
 * be read back as a price: signs, exponents, thousands separators, letters.
 * Zero is rejected because the contract's `InvalidAmount` rejects it too, and a
 * merchant who discovers that on-chain has paid a fee for nothing.
 *
 * `decimals` matches `toStroops`: a SEP-41 token picks its own scale, so a
 * 6-decimal token must be refused at the 7th place, not the 6th.
 */
export function checkAmount(input: string, decimals = DECIMALS): AmountCheck {
  const places = normalizeDecimals(decimals);
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, message: "Enter an amount." };
  }
  if (!/^\d+(\.\d*)?$/.test(trimmed)) {
    return { ok: false, message: "Enter a positive number, for example 2.5." };
  }
  const [whole = "0", frac = ""] = trimmed.split(".");
  if (frac.length > places) {
    return { ok: false, message: `At most ${places} decimal places.` };
  }
  const stroops = BigInt(whole) * 10n ** BigInt(places) + BigInt(frac.padEnd(places, "0") || "0");
  if (stroops <= 0n) {
    return { ok: false, message: "Amount must be greater than zero." };
  }
  return { ok: true, stroops };
}

/** Basis points in a percent. Mirrors BPS_DENOMINATOR in the subscription contract. */
export const BPS_DENOMINATOR = 10_000n;

/** Mirrors MAX_FEE_BPS in the subscription contract: at most 10%. */
export const MAX_FEE_BPS = 1_000;

export interface FeeSplit {
  /** What the subscriber is charged, in the token's smallest unit. */
  gross: bigint;
  /** The protocol's cut, also debited from the subscriber's vault. */
  fee: bigint;
  /** What reaches the merchant. `gross - fee`, exactly as the contract computes it. */
  net: bigint;
}

/**
 * Split an amount the way `charge` does in the subscription contract:
 * `fee = amount * fee_bps / 10_000` in integer division, then
 * `merchant_amount = amount - fee`.
 *
 * All three are bigint. Multiplying a stroop amount by a percent in floating
 * point is how a preview ends up promising a tenth of a stroop more than the
 * contract pays out — and a merchant who reconciles against the chain would see
 * it on the very first charge.
 *
 * The rate is clamped to `[0, MAX_FEE_BPS]`, the range the contract's
 * `set_fee_bps` accepts. A malformed value from a stale API or a bad read would
 * otherwise produce a negative payout in a preview that is supposed to
 * reassure.
 */
export function feeSplit(amount: bigint, feeBps: number): FeeSplit {
  const bps = Number.isFinite(feeBps)
    ? BigInt(Math.min(MAX_FEE_BPS, Math.max(0, Math.trunc(feeBps))))
    : 0n;
  const fee = (amount * bps) / BPS_DENOMINATOR;
  return { gross: amount, fee, net: amount - fee };
}

/** A basis-point rate as a readable percentage, e.g. 100 → "1%", 250 → "2.5%". */
export function formatFeeBps(feeBps: number): string {
  if (!Number.isFinite(feeBps) || feeBps <= 0) return "0%";
  const scaled = (feeBps * 100) / 10_000;
  // Basis points are integers, so the fraction is always exact in decimal.
  const text = scaled.toFixed(2).replace(/\.?0+$/, "");
  return `${text}%`;
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

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * A calendar date, e.g. "22 Nov 2026".
 *
 * Built from the timestamp's UTC fields with fixed English month names rather
 * than `toLocaleDateString`. The pages are prerendered on a server that is not
 * necessarily in the reader's timezone, so a locale-formatted date renders one
 * way during the build and another after hydration. These pages are static
 * exports: a mismatch there is a permanent console error, not a transient one.
 */
export function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  const d = new Date(unixSeconds * 1000);
  const month = MONTHS[d.getUTCMonth()] ?? "";
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

/**
 * A rough "in 5m" / "3d ago" rendering of a timestamp.
 *
 * `nowMs` is injectable so a caller that already holds its own reference time —
 * a test, or anything rendering a past instant — cannot have the two disagree.
 * Without it, asking "is this in the future?" and then asking "how far?" can
 * straddle a boundary and produce "Free trial ended 3 days ago (in 2h)".
 */
export function formatWhen(unixSeconds: number, nowMs: number = Date.now()): string {
  if (!unixSeconds) return "—";
  const delta = unixSeconds * 1000 - nowMs;
  const abs = Math.abs(delta);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return delta >= 0 ? "due now" : "just now";
  if (mins < 60) return delta >= 0 ? `in ${mins}m` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return delta >= 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return delta >= 0 ? `in ${days}d` : `${days}d ago`;
}
