import { describe, expect, it } from "vitest";
import { filterAndSortPlans } from "@/lib/plans";
import type { ApiPlan } from "@/lib/api";

function mockPlan(overrides: Partial<ApiPlan> = {}): ApiPlan {
  return {
    id: 1,
    merchant: "GMERCHANT",
    name: "Standard Plan",
    token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    amount: "10000000",
    period: 2_592_000, // 30 days (monthly)
    active: 1,
    ledger: 1000,
    ...overrides,
  };
}

describe("Filter and sort plans (#18)", () => {
  const p1 = mockPlan({ id: 1, amount: "10000000000000000000", period: 86_400 }); // Large BigInt, 1 day
  const p2 = mockPlan({ id: 2, amount: "5000000", period: 604_800 }); // Small BigInt, 1 week
  const p3 = mockPlan({ id: 3, amount: "20000000", period: 2_592_000 }); // Medium BigInt, 30 days
  const p4 = mockPlan({ id: 4, amount: "10000000000000000001", period: 31_536_000 }); // Very large BigInt, 1 year

  it("defaults to sorting newest first by ID", () => {
    const res = filterAndSortPlans([p1, p2, p3, p4]);
    expect(res.map((p) => p.id)).toEqual([4, 3, 2, 1]);
  });

  it("sorts by price ascending using bigint comparison", () => {
    const res = filterAndSortPlans([p1, p2, p3, p4], { sort: "price_asc" });
    // Expected order: p2 (5M), p3 (20M), p1 (10^19), p4 (10^19 + 1)
    expect(res.map((p) => p.id)).toEqual([2, 3, 1, 4]);
  });

  it("sorts by price descending using bigint comparison", () => {
    const res = filterAndSortPlans([p1, p2, p3, p4], { sort: "price_desc" });
    // Expected order: p4 (10^19 + 1), p1 (10^19), p3 (20M), p2 (5M)
    expect(res.map((p) => p.id)).toEqual([4, 1, 3, 2]);
  });

  it("sorts by period ascending", () => {
    const res = filterAndSortPlans([p4, p3, p2, p1], { sort: "period_asc" });
    // p1 (86_400), p2 (604_800), p3 (2_592_000), p4 (31_536_000)
    expect(res.map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });

  it("sorts by period descending", () => {
    const res = filterAndSortPlans([p1, p2, p3, p4], { sort: "period_desc" });
    expect(res.map((p) => p.id)).toEqual([4, 3, 2, 1]);
  });

  it("filters by period categories", () => {
    const all = [p1, p2, p3, p4];

    expect(filterAndSortPlans(all, { period: "daily" }).map((p) => p.id)).toEqual([1]);
    expect(filterAndSortPlans(all, { period: "weekly" }).map((p) => p.id)).toEqual([2]);
    expect(filterAndSortPlans(all, { period: "monthly" }).map((p) => p.id)).toEqual([3]);
    expect(filterAndSortPlans(all, { period: "yearly" }).map((p) => p.id)).toEqual([4]);
  });

  it("filters by exact numeric period in seconds", () => {
    const all = [p1, p2, p3, p4];
    expect(filterAndSortPlans(all, { period: "86400" }).map((p) => p.id)).toEqual([1]);
  });

  it("combines filter and sort", () => {
    const pWeekly1 = mockPlan({ id: 10, amount: "30000000", period: 604_800 });
    const pWeekly2 = mockPlan({ id: 11, amount: "10000000", period: 604_800 });

    const res = filterAndSortPlans([p1, pWeekly1, pWeekly2, p3], {
      period: "weekly",
      sort: "price_asc",
    });

    expect(res.map((p) => p.id)).toEqual([11, 10]);
  });
});
