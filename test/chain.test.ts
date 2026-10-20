import { describe, expect, it, vi } from "vitest";
import {
  chainMerchantSummary,
  chainPlanSubscriberCount,
  endable,
  mandateFunding,
  mandateToApi,
  merchantFromParam,
  newestPages,
} from "@/lib/chain";
import { mandatePauseUntil, mandateStatus, type Mandate } from "@/lib/payflow";
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

describe("newestPages", () => {
  it("covers only the newest entries, in contract-sized pages", () => {
    // 130 entries, want the newest 100, pages of 50: positions 30..129.
    expect(newestPages(130, 100, 50)).toEqual([
      [30, 50],
      [80, 50],
    ]);
  });

  it("reads everything when there are fewer entries than wanted", () => {
    expect(newestPages(7, 100, 50)).toEqual([[0, 7]]);
  });

  it("returns no pages for an empty index", () => {
    expect(newestPages(0, 100, 50)).toEqual([]);
  });

  it("never asks for more than one page holds", () => {
    for (const [, limit] of newestPages(1_000, 300, 50)) {
      expect(limit).toBeLessThanOrEqual(50);
    }
  });
});

describe("endable", () => {
  it("lets a merchant end only mandates that could still be charged", () => {
    expect(endable({ status: "Active" })).toBe(true);
    expect(endable({ status: "Paused" })).toBe(true);
    expect(endable({ status: "Cancelled" })).toBe(false);
    expect(endable({ status: "Completed" })).toBe(false);
  });
});

describe("pause_until from contract state", () => {
  const raw: Mandate = {
    id: 1n,
    subscriber: "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE",
    plan_id: 1n,
    merchant: MERCHANT,
    token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    amount: 10_000_000n,
    period: 60n,
    next_charge: 0n,
    last_charge: 0n,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: ["Paused"],
  };

  it("maps the contract's bigint onto an indexer-style number", () => {
    const until = Date.UTC(2026, 9, 25) / 1000;
    const m = mandateToApi({ ...raw, pause_until: BigInt(until) });

    expect(m.pause_until).toBe(until);
    expect(mandatePauseUntil(m)).toBe(until);
  });

  it("leaves it absent when the contract predates the field", () => {
    const m = mandateToApi(raw);

    expect(m.pause_until).toBeUndefined();
    // Absence is the capability signal; the page hides the picker.
    expect(mandatePauseUntil(m)).toBeNull();
  });

  it("treats a reported zero as support, not absence", () => {
    // A contract that ships the field reports 0 for "no dated pause". That is
    // still proof the contract can service one, so the control must be shown.
    const m = mandateToApi({ ...raw, pause_until: 0n });
    expect(m.pause_until).toBe(0);
    expect(mandatePauseUntil(m)).toBe(0);
  });
});

describe("mandate status from contract state", () => {
  // What scValToNative returns for a MandateStatus read from the contract.
  const raw: Mandate = {
    id: 1n,
    subscriber: "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE",
    plan_id: 1n,
    merchant: MERCHANT,
    token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    amount: 10_000_000n,
    period: 60n,
    next_charge: 0n,
    last_charge: 0n,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: ["Active"],
  };

  it("unwraps the enum vector into a plain name", () => {
    expect(mandateStatus(["Paused"])).toBe("Paused");
    expect(mandateStatus("Cancelled")).toBe("Cancelled");
    expect(mandateStatus(undefined)).toBe("");
  });

  it("gives the pages a status they can compare with ===", () => {
    const m = mandateToApi(raw);
    expect(m.status).toBe("Active");
    expect(chainMerchantSummary(MERCHANT, [m]).activeMandates).toBe(1);
  });
});

describe("merchantFromParam", () => {
  // The public merchant page reads /m/?address=G… from the query string.
  // A bad link must land on "check your link", never on an RPC call that
  // fails somewhere later.
  it("accepts a valid account address, trimmed", () => {
    expect(merchantFromParam(MERCHANT)).toBe(MERCHANT);
    expect(merchantFromParam(`  ${MERCHANT}  `)).toBe(MERCHANT);
  });

  it("rejects a missing or empty parameter", () => {
    expect(merchantFromParam(null)).toBeNull();
    expect(merchantFromParam("")).toBeNull();
    expect(merchantFromParam("   ")).toBeNull();
  });

  it("rejects a malformed address", () => {
    for (const bad of [
      "not-an-address",
      // Valid prefix, wrong checksum.
      `${MERCHANT.slice(0, -1)}A`,
      // A contract id is not a merchant account.
      "CDQ5EJTVXXX2CBMHWP3BGGUDHSK6D4I25IF5XXH3QGL2TNTBMJUOFKDB",
    ]) {
      expect(merchantFromParam(bad), `"${bad}" must be rejected`).toBeNull();
    }
  });
});

describe("mandateFunding", () => {
  const ONE_XLM = 10_000_000n;

  it("reports funded when the vault covers the mandate amount", () => {
    expect(mandateFunding(20_000_000n, ONE_XLM)).toEqual({ status: "funded", shortfall: 0n });
    expect(mandateFunding(ONE_XLM, ONE_XLM)).toEqual({ status: "funded", shortfall: 0n });
  });

  it("reports short with the exact stroops shortfall", () => {
    expect(mandateFunding(5_000_000n, ONE_XLM)).toEqual({ status: "short", shortfall: 5_000_000n });
    expect(mandateFunding(0n, ONE_XLM)).toEqual({ status: "short", shortfall: ONE_XLM });
  });

  it("treats a null balance as unknown, not short", () => {
    expect(mandateFunding(null, ONE_XLM)).toEqual({ status: "funded", shortfall: 0n });
  });

  it("keeps large shortfalls exact without floating point", () => {
    const huge = 10_000_000_000_000n; // 1 million XLM
    expect(mandateFunding(0n, huge)).toEqual({ status: "short", shortfall: huge });
  });
});

const payflowMock = vi.hoisted(() => ({
  planSubscriberCount: vi.fn<() => Promise<number>>(),
}));

vi.mock("@/lib/payflow", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/payflow")>();
  return { ...original, payflow: { ...original.payflow, ...payflowMock } };
});

describe("chainPlanSubscriberCount", () => {
  const SOURCE = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";

  it("returns the count when the contract supports the getter", async () => {
    payflowMock.planSubscriberCount.mockResolvedValue(7);
    expect(await chainPlanSubscriberCount(SOURCE, 1)).toBe(7);
  });

  it("returns null when the contract does not support the getter", async () => {
    // Old contracts throw; the fallback must hide the stat rather than
    // surface a zero that implies no one has subscribed.
    payflowMock.planSubscriberCount.mockRejectedValue(new Error("missing entry"));
    expect(await chainPlanSubscriberCount(SOURCE, 1)).toBeNull();
  });

  it("returns null on any other contract error", async () => {
    payflowMock.planSubscriberCount.mockRejectedValue(new Error("RPC timeout"));
    expect(await chainPlanSubscriberCount(SOURCE, 1)).toBeNull();
  });

  it("passes planId through to the contract call", async () => {
    payflowMock.planSubscriberCount.mockResolvedValue(3);
    await chainPlanSubscriberCount(SOURCE, 42);
    expect(payflowMock.planSubscriberCount).toHaveBeenCalledWith(SOURCE, 42);
  });
});
