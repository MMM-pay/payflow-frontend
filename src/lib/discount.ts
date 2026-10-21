import type { ApiMandate } from "./api";
import { formatAmount, type TokenMeta } from "./format";

/**
 * Merchant discounts on a single mandate.
 *
 * Depends on payflow-contract#37, which has not shipped. The proposed
 * interface is a per-mandate `discount_bps` (basis points off) and
 * `discount_charges` (how many charges the discount covers), with the
 * contract charging the discounted amount for the first N charges and the
 * full price afterwards. A discount can only lower the price.
 *
 * Until that lands, neither the deployed contract's `Mandate` nor the
 * indexer's rows carry the fields, so every reader here treats them as
 * optional: absent means "this source cannot say", which is not the same as
 * "no discount". The merchant's control stays hidden until the contract
 * answers with a discount, and a subscriber is never told about a discount
 * that does not exist.
 */

/** Basis points in 100%. Mirrors the protocol's own denominator. */
export const BPS_DENOMINATOR = 10_000;

/**
 * The largest discount that can be set.
 *
 * A discount of 100% is not offered: the charge would be zero, and a zero
 * charge is not a charge — the vault refuses to debit nothing. 99.99% is the
 * most a merchant can give.
 */
export const MAX_DISCOUNT_BPS = 9_999;

/** Anything that can carry a discount. */
export interface HasDiscount {
  discount_bps?: unknown;
  discount_charges?: unknown;
  discount_charges_made?: unknown;
}

/**
 * Whether the source can represent discounts at all.
 *
 * This is the gate for showing the merchant's control. It is answered from
 * data, not from a flag: a contract built before the change returns a
 * `Mandate` map with no `discount_bps` key, and the control must stay
 * hidden — calling a method the deployed contract does not have would fail
 * every transaction.
 */
export function supportsDiscounts(source: HasDiscount | null | undefined): boolean {
  const raw = source?.discount_bps;
  return typeof raw === "number" || typeof raw === "bigint";
}

/** The discount rate of a mandate in basis points, or 0 when it has none. */
export function discountBps(source: HasDiscount | null | undefined): number {
  const raw = source?.discount_bps;
  if (raw === undefined || raw === null) return 0;
  const n = typeof raw === "bigint" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

/** How many charges the discount covers, or 0 when it covers none. */
export function discountCharges(source: HasDiscount | null | undefined): number {
  const raw = source?.discount_charges;
  if (raw === undefined || raw === null) return 0;
  const n = typeof raw === "bigint" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

/**
 * How many discounted charges are left, or null when the source cannot say.
 *
 * The contract counts the charges the discount covered, so the remainder is
 * the difference between the two. A mandate that carries a discount but no
 * count of the charges already made is a contract that has not been updated
 * yet, and the remainder is unknown rather than zero.
 */
export function remainingDiscountCharges(
  source: HasDiscount | null | undefined,
): number | null {
  if (!supportsDiscounts(source)) return null;
  const total = discountCharges(source);
  if (total === 0) return 0;
  const raw = source?.discount_charges_made;
  if (raw === undefined || raw === null) return null;
  const made = typeof raw === "bigint" ? Number(raw) : Number(raw);
  if (!Number.isFinite(made) || made < 0) return null;
  return Math.max(0, total - Math.trunc(made));
}

/**
 * What a discount rate is worth, in the token's smallest unit.
 *
 * `amount * (10_000 - bps) / 10_000` in integer arithmetic, exactly as the
 * contract would compute it. A percentage of a rounded display string is
 * how a preview ends up promising a fraction of a stroop more than the chain
 * charges.
 */
export function discountedAmount(amount: bigint, bps: number): bigint {
  const rate = Number.isFinite(bps)
    ? Math.min(MAX_DISCOUNT_BPS, Math.max(0, Math.trunc(bps)))
    : 0;
  return (amount * BigInt(BPS_DENOMINATOR - rate)) / BigInt(BPS_DENOMINATOR);
}

/** What a discount rate is worth, as a readable amount. */
export function discountedAmountText(
  amount: bigint,
  bps: number,
  meta: TokenMeta,
): string {
  return formatAmount(discountedAmount(amount, bps), meta);
}

/** A basis-point rate as a percentage, e.g. 2000 → "20%", 1250 → "12.5%". */
export function formatDiscountBps(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "0%";
  const scaled = (bps * 100) / BPS_DENOMINATOR;
  const text = scaled.toFixed(2).replace(/\.?0+$/, "");
  return `${text}%`;
}

/**
 * What a form should say about the discount a merchant typed.
 *
 * The percentage is read as a decimal string and converted to basis points in
 * integer arithmetic: "12.5" is 1250 basis points exactly, while
 * `12.5 * 100` in floating point is 1250.0000000000002.
 */
export type DiscountCheck =
  | { ok: true; bps: number }
  | { ok: false; message: string };

export function checkDiscountBps(input: string): DiscountCheck {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, message: "Enter a discount." };
  }
  // At most two decimals: a third would not be a whole number of basis
  // points, and the contract stores basis points.
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      message: "Enter a percentage, for example 20 or 12.5.",
    };
  }
  const whole = match[1] ?? "0";
  const frac = match[2] ?? "";
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(bps)) {
    return { ok: false, message: "That discount is too large." };
  }
  if (bps === 0) {
    return { ok: false, message: "A discount must be greater than zero." };
  }
  if (bps > MAX_DISCOUNT_BPS) {
    return {
      ok: false,
      message: "A discount cannot be 100% or more.",
    };
  }
  return { ok: true, bps };
}

/**
 * What a form should say about the number of charges a discount covers.
 *
 * Zero would mean "no discount", which is not a discount: the merchant would
 * be told the change was applied while the price stayed the same.
 */
export type ChargesCheck =
  | { ok: true; charges: number }
  | { ok: false; message: string };

export function checkDiscountCharges(input: string): ChargesCheck {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, message: "Enter the number of charges." };
  }
  if (!/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      message: "Enter a whole number of charges, for example 3.",
    };
  }
  const charges = Number(trimmed);
  if (!Number.isSafeInteger(charges) || charges < 1) {
    return { ok: false, message: "A discount must cover at least one charge." };
  }
  return { ok: true, charges };
}

/**
 * The label of a discount, e.g. "20% off for 3 charges".
 *
 * One charge reads "the next charge", which is what a merchant means.
 */
export function discountLabel(bps: number, charges: number): string {
  const percent = formatDiscountBps(bps);
  if (charges === 1) return `${percent} off the next charge`;
  return `${percent} off for ${charges} charges`;
}

/** The badge of a discounted mandate, or null when it has no discount. */
export function discountBadge(
  source: HasDiscount | null | undefined,
): string | null {
  const bps = discountBps(source);
  const charges = discountCharges(source);
  if (bps === 0 || charges === 0) return null;
  return discountLabel(bps, charges);
}

/**
 * What the subscriber pays for the next charge, when the mandate carries a
 * discount that is still running.
 *
 * Null when there is no discount, or when the discount has run out: the
 * subscriber pays the full price then, and saying "0.8 XLM" would be wrong.
 */
export function nextChargeAmount(
  mandate: Pick<ApiMandate, "amount"> & HasDiscount,
): bigint | null {
  const bps = discountBps(mandate);
  const charges = discountCharges(mandate);
  if (bps === 0 || charges === 0) return null;
  const remaining = remainingDiscountCharges(mandate);
  // The count of the charges already made is unknown: the discount may or
  // may not have run out, so the price is not claimed.
  if (remaining === null) return null;
  if (remaining === 0) return null;
  return discountedAmount(BigInt(mandate.amount), bps);
}
