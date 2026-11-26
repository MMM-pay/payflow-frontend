import type { ApiPlan } from "./api";

export type PlanSortOption =
  | "newest"
  | "oldest"
  | "price_asc"
  | "price_desc"
  | "period_asc"
  | "period_desc"
  | "popularity_asc"
  | "popularity_desc";

export type PlanPeriodOption =
  | "all"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | string;

/** Which plans a listing should show: every plan, or only active/inactive ones. */
export type PlanActiveOption = "all" | "active" | "inactive";

/**
 * The name a plan is displayed under.
 *
 * Plans created before names shipped have an empty label; the listing shows
 * them as "Plan #id", so searching for that label finds them too.
 */
export function planDisplayName(plan: Pick<ApiPlan, "id" | "name">): string {
  return plan.name?.trim() || `Plan #${plan.id}`;
}

/** Whether a plan matches a free-text search by name (case-insensitive). */
export function planMatchesQuery(
  plan: Pick<ApiPlan, "id" | "name">,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const name = planDisplayName(plan).toLowerCase();
  return name.includes(needle) || `#${plan.id}`.includes(needle);
}

/**
 * Open subscribers on a plan, used for popularity ordering.
 *
 * `subscriber_count` is the indexer's open-mandate count (active and paused).
 * Contract-only listings do not carry it, so a plan without a reported count
 * sorts as zero instead of being dropped from the catalogue.
 */
function planSubscriberCount(plan: ApiPlan): number {
  return countOpenMandates(plan.id, null, plan.subscriber_count);
}

/**
 * Filter and sort plans for a listing.
 *
 * All price sorting uses bigint arithmetic on token stroops so there is
 * never any floating-point truncation or precision loss. `query` searches the
 * display name (or "Plan #id" when a legacy plan has no name); `token` and
 * `active` narrow the list without changing its sort order.
 */
export function filterAndSortPlans(
  plans: ApiPlan[],
  options: {
    sort?: PlanSortOption;
    period?: PlanPeriodOption;
    query?: string;
    token?: string;
    active?: PlanActiveOption;
  } = {},
): ApiPlan[] {
  let result = [...plans];

  // Name search. Kept before the period/token filters so the counts reported
  // by the UI always describe the same list the cards come from.
  const query = options.query ?? "";
  if (query.trim() !== "") {
    result = result.filter((plan) => planMatchesQuery(plan, query));
  }

  // Token filter. "all" (and an empty value) means every token.
  if (options.token && options.token !== "all") {
    result = result.filter((plan) => plan.token === options.token);
  }

  // Active filter. `active` is 1/0 in the API and contract data; anything
  // that is not explicitly 1 is treated as inactive rather than guessed.
  if (options.active === "active") {
    result = result.filter((plan) => plan.active === 1);
  } else if (options.active === "inactive") {
    result = result.filter((plan) => plan.active !== 1);
  }

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
      case "popularity_asc": {
        const diff = planSubscriberCount(a) - planSubscriberCount(b);
        return diff !== 0 ? diff : b.id - a.id;
      }
      case "popularity_desc": {
        const diff = planSubscriberCount(b) - planSubscriberCount(a);
        return diff !== 0 ? diff : b.id - a.id;
      }
      case "oldest":
        return a.id - b.id;
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

