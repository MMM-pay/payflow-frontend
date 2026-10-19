import type { ApiMandate } from "./api";
import {
  discountBps,
  discountedAmount,
  remainingDiscountCharges,
} from "./discount";

/**
 * The next few charges a mandate will make.
 *
 * Pure so both the page and its tests can ask the same question: what will be
 * charged, when, and how much in total. Everything stays on the mandate's
 * `next_charge` / `period` arithmetic, which mirrors the contract's fixed
 * second-count periods — no calendar months, no locale-dependent dates, and
 * no floating point on amounts.
 */

/** How many upcoming charges the timeline shows. */
export const UPCOMING_CHARGE_LIMIT = 6;

/** The fields the schedule needs; a full `ApiMandate` satisfies this. */
export type SchedulableMandate = Pick<
  ApiMandate,
  | "status"
  | "amount"
  | "period"
  | "next_charge"
  | "charges_made"
  | "max_charges"
  | "discount_bps"
  | "discount_charges"
  | "discount_charges_made"
>;

export interface ScheduledCharge {
  /** 1-based position within the displayed schedule. */
  index: number;
  /** Unix seconds the charge falls due. */
  due: number;
  /** Charge amount in the token's smallest unit. */
  amount: bigint;
  /** Running total through this charge, in the same unit. */
  total: bigint;
}

export interface ChargeSchedule {
  charges: ScheduledCharge[];
  /** Sum of the displayed charges. */
  total: bigint;
  /**
   * Unix seconds of the mandate's final charge when `max_charges > 0`, even
   * when that charge is beyond the displayed horizon. Null when the mandate is
   * open-ended.
   */
  finalDate: number | null;
  /** Charges left before the cap, or null when open-ended. */
  remaining: number | null;
}

const EMPTY: ChargeSchedule = {
  charges: [],
  total: 0n,
  finalDate: null,
  remaining: null,
};

/**
 * How far a vault balance falls short of one charge, in the smallest unit, or
 * null when it can cover it (or the balance is not known yet).
 *
 * A null balance means the read is still in flight or failed. That is "not
 * known", not "empty": treating it as a shortfall would block a charge the
 * contract may well accept.
 */
export function chargeShortfall(
  balance: bigint | null,
  amount: bigint,
): bigint | null {
  if (balance === null) return null;
  const shortfall = amount - balance;
  return shortfall > 0n ? shortfall : null;
}

/**
 * Build the next `limit` charges for an active mandate.
 *
 * Returns an empty schedule for paused, cancelled and completed mandates, for
 * malformed timing data, and for a capped mandate that has already made every
 * charge it is allowed (a stale "Active" from the indexer catches up later).
 * The page uses the empty result as the signal not to render a timeline at
 * all, which keeps terminal mandates free of misleading future dates.
 */
export function buildChargeSchedule(
  mandate: SchedulableMandate,
  limit: number = UPCOMING_CHARGE_LIMIT,
): ChargeSchedule {
  if (mandate.status !== "Active") return EMPTY;
  if (!Number.isFinite(mandate.next_charge) || mandate.next_charge <= 0) {
    return EMPTY;
  }
  if (!Number.isFinite(mandate.period) || mandate.period <= 0) return EMPTY;

  let baseAmount: bigint;
  try {
    baseAmount = BigInt(mandate.amount);
  } catch {
    return EMPTY;
  }
  if (baseAmount <= 0n) return EMPTY;

  // A mandate may carry a merchant discount for its first N charges. When the
  // source cannot report how many discounted charges are left, keep the full
  // price rather than inventing a lower one — the same rule `nextChargeAmount`
  // uses for the summary card.
  const bps = discountBps(mandate);
  const discountLeft = remainingDiscountCharges(mandate);
  const amountFor = (offset: number): bigint =>
    bps > 0 && discountLeft !== null && offset < discountLeft
      ? discountedAmount(baseAmount, bps)
      : baseAmount;

  const capped = mandate.max_charges > 0;
  const remaining = capped
    ? Math.max(0, mandate.max_charges - mandate.charges_made)
    : null;
  if (remaining === 0) return EMPTY;

  const wanted = Math.max(0, Math.trunc(limit));
  const count = remaining === null ? wanted : Math.min(wanted, remaining);
  if (count === 0) return EMPTY;

  const charges: ScheduledCharge[] = [];
  let total = 0n;
  for (let i = 0; i < count; i += 1) {
    const amount = amountFor(i);
    total += amount;
    charges.push({
      index: i + 1,
      due: mandate.next_charge + i * mandate.period,
      amount,
      total,
    });
  }

  return {
    charges,
    total,
    finalDate:
      remaining === null
        ? null
        : mandate.next_charge + (remaining - 1) * mandate.period,
    remaining,
  };
}
