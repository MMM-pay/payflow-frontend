import type { ApiPlan } from "./api";

/**
 * Side-by-side plan comparison.
 *
 * A subscriber can tick up to three plans and see the numbers that are hard to
 * compare while scrolling. Everything here is pure and takes amounts as
 * smallest-unit decimal strings or bigints: a "monthly equivalent" is a money
 * figure, so it is never computed through `Number`.
 */

/** How many plans a comparison may hold. */
export const COMPARE_LIMIT = 3;

/**
 * The month a monthly equivalent is expressed against.
 *
 * 30 days, mirroring the "Monthly" preset and the contract's fixed-second
 * periods (2_592_000 seconds). Calendar months vary, so using one would make
 * two plans with the same period compare differently depending on the date.
 */
export const MONTH_SECONDS = 2_592_000;

/** An amount converted to smallest units, or null when the source is malformed. */
export function parseAmountValue(raw: string | bigint | null | undefined): bigint | null {
  if (typeof raw === "bigint") return raw >= 0n ? raw : null;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const value = BigInt(raw);
    return value >= 0n ? value : null;
  } catch {
    return null;
  }
}

/**
 * What `amount` per `periodSeconds` costs over 30 days, in the token's
 * smallest unit.
 *
 * Pure bigint arithmetic. Integer division truncates toward zero, the same
 * direction the vault rounds a debit, so a displayed equivalent can never be
 * larger than the sum of the charges it represents. A non-positive or
 * non-finite period yields 0 because there is no meaningful monthly price.
 */
export function monthlyEquivalent(amount: bigint, periodSeconds: number): bigint {
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) return 0n;
  const period = BigInt(Math.trunc(periodSeconds));
  if (period <= 0n) return 0n;
  return (amount * BigInt(MONTH_SECONDS)) / period;
}

/**
 * `monthlyEquivalent` for an API/contract plan, or null when its amount cannot
 * be read. Null is deliberately distinct from 0: "unknown" must render as a
 * dash, not as "free".
 */
export function planMonthlyEquivalent(
  plan: Pick<ApiPlan, "amount" | "period">,
): bigint | null {
  const amount = parseAmountValue(plan.amount);
  if (amount === null) return null;
  if (!Number.isFinite(plan.period) || plan.period <= 0) return null;
  return monthlyEquivalent(amount, plan.period);
}

/**
 * Add or remove a plan from a comparison selection.
 *
 * The limit is part of the function rather than the caller so a selection can
 * never grow past three, even if a component forgets to disable a checkbox.
 * Adding a fourth returns the original selection unchanged. Selection order is
 * kept, because the table's columns should stay put while the user ticks.
 */
export function togglePlanComparison(
  selected: readonly number[],
  id: number,
  limit: number = COMPARE_LIMIT,
): number[] {
  if (selected.includes(id)) return selected.filter((item) => item !== id);
  if (selected.length >= limit) return [...selected];
  return [...selected, id];
}

/** The plans named by a selection, in selection order, ignoring unknown ids. */
export function plansForComparison(
  plans: readonly ApiPlan[],
  selected: readonly number[],
): ApiPlan[] {
  return selected
    .map((id) => plans.find((plan) => plan.id === id))
    .filter((plan): plan is ApiPlan => plan !== undefined);
}
