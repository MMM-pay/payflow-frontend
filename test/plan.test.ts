import { describe, expect, it } from "vitest";
import { planChargeRow } from "@/lib/chain";
import type { ApiCharge } from "@/lib/api";

/**
 * `planChargeRow` turns contract charge data into display rows. Amounts are
 * derived from smallest-unit bigints and shown as decimal strings, never
 * floats, so bookkeeping values stay exact.
 */

function charge(over: Partial<ApiCharge> = {}): ApiCharge {
  return {
    tx_hash: "abcd1234",
    mandate_id: 7,
    amount: "10000000", // 1 XLM
    fee: "100000", // 0.01 XLM
    charges_made: 1,
    ledger: 50000,
    ...over,
  };
}

describe("planChargeRow", () => {
  it("computes gross, fee, and net as decimal strings", () => {
    const row = planChargeRow(charge(), "GAB6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE");
    expect(row.amount).toBe("1");
    expect(row.fee).toBe("0.01");
    expect(row.net).toBe("0.99");
  });

  it("passes through mandate id, subscriber, tx hash, and ledger", () => {
    const row = planChargeRow(charge({ mandate_id: 3, tx_hash: "deadbeef", ledger: 42 }), "GAM6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE");
    expect(row.mandateId).toBe(3);
    expect(row.subscriber).toBe("GAM6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE");
    expect(row.txHash).toBe("deadbeef");
    expect(row.ledger).toBe(42);
  });

  it("keeps large amounts exact without floating point", () => {
    // 1 million XLM gross, 50 thousand XLM fee — beyond safe integer range
    // once scaled to stroops, so floats would lose precision.
    const row = planChargeRow(
      charge({ amount: "10000000000000", fee: "500000000000" }),
      "GAA6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE",
    );
    expect(row.amount).toBe("1000000");
    expect(row.fee).toBe("50000");
    expect(row.net).toBe("950000");
  });

  it("handles zero-fee charges", () => {
    const row = planChargeRow(charge({ fee: "0" }), "GAB6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE");
    expect(row.fee).toBe("0");
    expect(row.net).toBe(row.amount);
  });

  it("handles zero-amount charges", () => {
    const row = planChargeRow(charge({ amount: "0", fee: "0" }), "GAB6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE");
    expect(row.amount).toBe("0");
    expect(row.fee).toBe("0");
    expect(row.net).toBe("0");
  });
});
