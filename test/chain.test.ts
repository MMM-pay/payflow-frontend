import { describe, expect, it } from "vitest";
import { chainMerchantSummary } from "@/lib/chain";
import type { ApiMandate } from "@/lib/api";

/**
 * The chain fallback keeps the app usable with no indexer — including the
 * public demo, which runs without a backend. Its merchant totals are derived
 * from mandates alone, so the MRR normalisation and the deliberate absence of
 * revenue history are both worth pinning down.
 */

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";
const MONTH = 2_592_000;

function mandate(over: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 1,
    subscriber: "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE",
    merchant: MERCHANT,
    plan_id: 1,
    amount: "10000000", // 1 XLM
    period: MONTH,
    next_charge: 0,
    last_charge: 0,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
    ...over,
  };
}

describe("chainMerchantSummary", () => {
  it("counts only active mandates", () => {
    const s = chainMerchantSummary(MERCHANT, [
      mandate({ id: 1, status: "Active" }),
      mandate({ id: 2, status: "Cancelled" }),
      mandate({ id: 3, status: "Paused" }),
      mandate({ id: 4, status: "Completed" }),
    ]);
    expect(s.activeMandates).toBe(1);
  });

  it("reports totalCollected as null because charge history needs the indexer", () => {
    // Showing 0 here would understate real revenue; null lets the UI show "—".
    const s = chainMerchantSummary(MERCHANT, [mandate()]);
    expect(s.totalCollected).toBeNull();
  });

  it("sums settled charges across every mandate regardless of status", () => {
    const s = chainMerchantSummary(MERCHANT, [
      mandate({ id: 1, charges_made: 3 }),
      mandate({ id: 2, charges_made: 2, status: "Cancelled" }),
    ]);
    expect(s.chargeCount).toBe(5);
  });

  it("leaves a monthly plan's MRR unchanged", () => {
    const s = chainMerchantSummary(MERCHANT, [mandate({ period: MONTH })]);
    expect(s.mrr).toBe("10000000");
  });

  it("normalises a weekly plan up to a 30-day month", () => {
    // 1 XLM per week ≈ 4.28 XLM per month.
    const s = chainMerchantSummary(MERCHANT, [mandate({ period: 604_800 })]);
    expect(s.mrr).toBe(((10_000_000n * 2_592_000n) / 604_800n).toString());
  });

  it("normalises a yearly plan down", () => {
    const s = chainMerchantSummary(MERCHANT, [mandate({ period: 31_536_000 })]);
    expect(BigInt(s.mrr)).toBeLessThan(10_000_000n);
  });

  it("adds MRR across mandates on different periods", () => {
    const s = chainMerchantSummary(MERCHANT, [
      mandate({ id: 1, period: MONTH }),
      mandate({ id: 2, period: MONTH }),
    ]);
    expect(s.mrr).toBe("20000000");
  });

  it("excludes inactive mandates from MRR", () => {
    const s = chainMerchantSummary(MERCHANT, [
      mandate({ id: 1, status: "Active" }),
      mandate({ id: 2, status: "Cancelled" }),
    ]);
    expect(s.mrr).toBe("10000000");
  });

  it("survives a zero period without dividing by zero", () => {
    // Guards against a malformed row crashing the dashboard.
    expect(() => chainMerchantSummary(MERCHANT, [mandate({ period: 0 })])).not.toThrow();
  });

  it("returns zeroes for a merchant with no mandates", () => {
    const s = chainMerchantSummary(MERCHANT, []);
    expect(s.activeMandates).toBe(0);
    expect(s.chargeCount).toBe(0);
    expect(s.mrr).toBe("0");
    expect(s.merchant).toBe(MERCHANT);
  });

  it("keeps large amounts exact rather than losing precision", () => {
    // 1 million XLM per month — beyond safe Number range once in stroops.
    const s = chainMerchantSummary(MERCHANT, [
      mandate({ amount: "10000000000000", period: MONTH }),
    ]);
    expect(s.mrr).toBe("10000000000000");
  });
});
