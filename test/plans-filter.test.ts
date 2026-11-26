import { describe, expect, it } from "vitest";
import { filterAndSortPlans, planDisplayName, planMatchesQuery } from "@/lib/plans";
import type { ApiPlan } from "@/lib/api";

const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

function plan(overrides: Partial<ApiPlan> = {}): ApiPlan {
  return {
    id: 1,
    merchant: "GMERCHANT",
    name: "Monthly Software",
    token: XLM,
    amount: "10000000",
    period: 2_592_000,
    active: 1,
    ledger: 10,
    ...overrides,
  };
}

const plans = [
  plan({ id: 1, name: "Monthly Software", token: XLM, active: 1 }),
  plan({ id: 2, name: "Daily Coffee", token: USDC, active: 1 }),
  plan({ id: 3, name: "", token: USDC, active: 0, amount: "20000000" }),
  plan({ id: 4, name: "Annual Hosting", token: XLM, active: 0, period: 31_536_000 }),
];

describe("plan search and filters (#300)", () => {
  it("labels a legacy plan without a name", () => {
    expect(planDisplayName(plans[2]!)).toBe("Plan #3");
    expect(planDisplayName(plans[0]!)).toBe("Monthly Software");
  });

  it("searches names case-insensitively and trims whitespace", () => {
    expect(planMatchesQuery(plans[0]!, "  monthly  ")).toBe(true);
    expect(planMatchesQuery(plans[1]!, "SOFTWARE")).toBe(false);
    expect(planMatchesQuery(plans[0]!, "")).toBe(true);
  });

  it("lets a legacy plan be found by its generated label or id", () => {
    expect(planMatchesQuery(plans[2]!, "plan #3")).toBe(true);
    expect(planMatchesQuery(plans[2]!, "#3")).toBe(true);
  });

  it("narrows by token while keeping the default newest-first sort", () => {
    const result = filterAndSortPlans(plans, { token: USDC });
    expect(result.map((p) => p.id)).toEqual([3, 2]);
  });

  it("narrows by active flag", () => {
    expect(filterAndSortPlans(plans, { active: "active" }).map((p) => p.id)).toEqual([2, 1]);
    expect(filterAndSortPlans(plans, { active: "inactive" }).map((p) => p.id)).toEqual([4, 3]);
    expect(filterAndSortPlans(plans, { active: "all" })).toHaveLength(4);
  });

  it("combines search, token and status", () => {
    expect(
      filterAndSortPlans(plans, { query: "coffee", token: USDC, active: "active" }).map(
        (p) => p.id,
      ),
    ).toEqual([2]);
    expect(
      filterAndSortPlans(plans, { query: "nothing here", token: XLM, active: "active" }),
    ).toEqual([]);
  });

  it("keeps the price sort working alongside the new filters", () => {
    const result = filterAndSortPlans(plans, { sort: "price_desc", active: "inactive" });
    expect(result.map((p) => p.id)).toEqual([3, 4]);
  });
});
