import { describe, expect, it } from "vitest";
import {
  COMPARE_LIMIT,
  MONTH_SECONDS,
  monthlyEquivalent,
  planMonthlyEquivalent,
  plansForComparison,
  togglePlanComparison,
} from "@/lib/compare";
import type { ApiPlan } from "@/lib/api";

function plan(overrides: Partial<ApiPlan> = {}): ApiPlan {
  return {
    id: 1,
    merchant: "GMERCHANT",
    name: "Plan",
    token: "CTOKEN",
    amount: "10000000",
    period: MONTH_SECONDS,
    active: 1,
    ledger: 1,
    ...overrides,
  };
}

describe("monthly equivalent (#175)", () => {
  it("is the amount itself for a 30-day plan", () => {
    expect(monthlyEquivalent(10_000_000n, MONTH_SECONDS)).toBe(10_000_000n);
  });

  it("scales daily and weekly prices to 30 days", () => {
    expect(monthlyEquivalent(5_000_000n, 86_400)).toBe(150_000_000n);
    expect(monthlyEquivalent(7_000_000n, 604_800)).toBe(30_000_000n);
  });

  it("uses integer division, never floating point", () => {
    // 1 stroop a week * 30 / 7 = 4.285… → 4, not 4.285…
    expect(monthlyEquivalent(1n, 604_800)).toBe(4n);
    // A value beyond Number.MAX_SAFE_INTEGER keeps every digit.
    const huge = 10n ** 30n;
    expect(monthlyEquivalent(huge, 86_400)).toBe(huge * 30n);
  });

  it("returns zero for a period the contract could not have created", () => {
    expect(monthlyEquivalent(100n, 0)).toBe(0n);
    expect(monthlyEquivalent(100n, -30)).toBe(0n);
    expect(monthlyEquivalent(100n, Number.NaN)).toBe(0n);
  });

  it("returns null for a malformed plan amount rather than a fake zero", () => {
    expect(planMonthlyEquivalent(plan({ amount: "not-a-number" }))).toBeNull();
    expect(planMonthlyEquivalent(plan({ period: 0 }))).toBeNull();
    expect(planMonthlyEquivalent(plan({ amount: "10000000", period: 86_400 }))).toBe(
      300_000_000n,
    );
  });
});

describe("comparison selection (#175)", () => {
  it("toggles a plan in and out in selection order", () => {
    expect(togglePlanComparison([], 2)).toEqual([2]);
    expect(togglePlanComparison([2], 1)).toEqual([2, 1]);
    expect(togglePlanComparison([2, 1], 2)).toEqual([1]);
  });

  it("holds at three plans", () => {
    const full = [1, 2, 3];
    expect(togglePlanComparison(full, 4)).toEqual(full);
    expect(full.length).toBe(COMPARE_LIMIT);
  });

  it("resolves selected plans in pick order and ignores missing ids", () => {
    const plans = [plan({ id: 1, name: "One" }), plan({ id: 2, name: "Two" })];
    expect(plansForComparison(plans, [2, 9, 1]).map((p) => p.name)).toEqual(["Two", "One"]);
  });
});
