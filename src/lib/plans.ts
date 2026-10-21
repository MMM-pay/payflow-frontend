import type { ApiPlan } from "./api";

export type PlanSortOption =
  | "newest"
  | "price_asc"
  | "price_desc"
  | "period_asc"
  | "period_desc";

export type PlanPeriodOption =
  | "all"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | string;

/**
 * Filter and sort plans for the subscriber catalog.
 *
 * All price sorting uses bigint arithmetic on token stroops so there is
 * never any floating-point truncation or precision loss.
 */
export function filterAndSortPlans(
  plans: ApiPlan[],
  options: {
    sort?: PlanSortOption;
    period?: PlanPeriodOption;
  } = {},
): ApiPlan[] {
  let result = [...plans];

  // Billing period filter
  if (options.period && options.period !== "all") {
    const p = options.period.toLowerCase();
    result = result.filter((plan) => {
      if (p === "daily") return plan.period <= 86_400;
      if (p === "weekly") return plan.period > 86_400 && plan.period <= 604_800;
      if (p === "monthly") return plan.period > 604_800 && plan.period <= 2_592_000;
      if (p === "yearly") return plan.period > 2_592_000;
      const num = Number(p);
      if (Number.isFinite(num) && num > 0) {
        return plan.period === num;
      }
      return true;
    });
  }

  // Sort
  const sort = options.sort ?? "newest";
  result.sort((a, b) => {
    switch (sort) {
      case "price_asc": {
        const diff = BigInt(a.amount) - BigInt(b.amount);
        return diff < 0n ? -1 : diff > 0n ? 1 : b.id - a.id;
      }
      case "price_desc": {
        const diff = BigInt(b.amount) - BigInt(a.amount);
        return diff < 0n ? -1 : diff > 0n ? 1 : b.id - a.id;
      }
      case "period_asc": {
        const diff = a.period - b.period;
        return diff !== 0 ? diff : b.id - a.id;
      }
      case "period_desc": {
        const diff = b.period - a.period;
        return diff !== 0 ? diff : b.id - a.id;
      }
      case "newest":
      default:
        return b.id - a.id;
    }
  });

  return result;
}

/**
 * Normalizes a mandate status across API objects ("Active") and contract
 * state tuples (["Active"]).
 */
export function normalizeMandateStatus(raw: unknown): string {
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw ?? "");
}

/**
 * Count the open (active or paused) mandates on a plan.
 *
 * Checks both the `mandates` list (from API or contract state) and falls back
 * to `planStatsSubscriberCount` (from contract or backend stats).
 *
 * Works in both API mode and contract-only mode.
 */
export function countOpenMandates(
  planId: number,
  mandates?: ReadonlyArray<{ plan_id: number; status: unknown }> | null,
  planStatsSubscriberCount?: number | null,
): number {
  if (mandates && mandates.length > 0) {
    const matching = mandates.filter(
      (m) =>
        m.plan_id === planId &&
        (normalizeMandateStatus(m.status) === "Active" ||
          normalizeMandateStatus(m.status) === "Paused"),
    ).length;
    if (typeof planStatsSubscriberCount === "number") {
      return Math.max(matching, planStatsSubscriberCount);
    }
    return matching;
  }
  if (typeof planStatsSubscriberCount === "number") {
    return planStatsSubscriberCount;
  }
  return 0;
}

