import { checkAmount, fromStroops, parseAmount } from "./format";

/**
 * Deposit coverage in the units a subscriber thinks in.
 *
 * The vault holds a raw amount, but a subscriber usually wants a number of
 * billing periods covered. The two are the same thing at a fixed plan price,
 * so the subscribe page keeps both fields in step: editing periods rewrites
 * the amount, and editing the amount derives the whole periods it covers
 * (rounded down, because half a period is not coverage).
 */

export type DepositMode = "periods" | "amount";

/** How many periods the guided flow suggests funding. */
export const DEFAULT_DEPOSIT_PERIODS = 3;

export const PERIODS_ERROR = "Enter a whole number of periods.";

function planPrice(planAmount: string | bigint): bigint {
  if (typeof planAmount === "bigint") return planAmount > 0n ? planAmount : 0n;
  try {
    const parsed = BigInt(planAmount.trim());
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

/** A positive whole number of periods, or null when the field is not one. */
export function parseDepositPeriods(input: string): number | null {
  const text = input.trim();
  if (!/^\d+$/.test(text)) return null;
  const periods = Number(text);
  return Number.isSafeInteger(periods) && periods > 0 ? periods : null;
}

/** The amount that covers `periods` charges, or null for an unusable input. */
export function amountForPeriods(
  periods: number | string,
  planAmount: string | bigint,
): bigint | null {
  const count = typeof periods === "number" ? periods : parseDepositPeriods(periods);
  const price = planPrice(planAmount);
  if (count === null || count <= 0 || price === 0n) return null;
  return price * BigInt(count);
}

/**
 * Whole periods an amount covers, or null when there is no price to divide by.
 * A deposit below one period's price covers 0 periods — it is still a valid
 * deposit, so this is not an error.
 */
export function periodsForAmount(
  amount: bigint,
  planAmount: string | bigint,
): number | null {
  const price = planPrice(planAmount);
  if (price === 0n || amount < 0n) return null;
  return Number(amount / price);
}

export interface DepositCoverage {
  /** Whole periods covered, when the input parses. */
  periods: number | null;
  /** The amount in the token's smallest unit, when the input parses. */
  amount: bigint | null;
  /** Why this deposit cannot be submitted, or null. */
  error: string | null;
}

/**
 * Validate whichever field the subscriber is editing and report both units.
 *
 * A malformed amount keeps the raw text visible on the page; this only decides
 * whether the Deposit button may fire.
 */
export function depositCoverage(
  mode: DepositMode,
  input: string,
  planAmount: string | bigint,
  decimals: number,
  locale?: string,
): DepositCoverage {
  const price = planPrice(planAmount);
  if (price === 0n) {
    return { periods: null, amount: null, error: "This plan has no price to cover." };
  }

  if (mode === "periods") {
    const periods = parseDepositPeriods(input);
    if (periods === null) {
      return { periods: null, amount: null, error: PERIODS_ERROR };
    }
    return { periods, amount: price * BigInt(periods), error: null };
  }

  const check = checkAmount(input, decimals, locale);
  if (!check.ok) return { periods: null, amount: null, error: check.message };
  const amount = parseAmount(input, decimals, locale);
  return { periods: periodsForAmount(amount, price), amount, error: null };
}

/** The amount field's text for a period count, e.g. "10" for two 5 XLM periods. */
export function periodsToAmountText(
  periods: number,
  planAmount: string | bigint,
  decimals: number,
): string {
  const amount = amountForPeriods(periods, planAmount);
  return amount === null ? "" : fromStroops(amount, decimals, decimals);
}
