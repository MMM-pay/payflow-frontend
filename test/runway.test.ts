import { describe, expect, it } from "vitest";
import { computeVaultRunway, formatRunway } from "@/lib/runway";
import type { ApiMandate } from "@/lib/api";

function mockMandate(overrides: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 1,
    subscriber: "GSUBSCRIBER",
    merchant: "GMERCHANT",
    plan_id: 1,
    amount: "10000000", // 1 XLM (10_000_000 stroops)
    period: 86400, // 1 day
    next_charge: 1700000000,
    last_charge: 1699913600,
    charges_made: 0,
    max_charges: 0, // open-ended
    fee_bps: 100,
    status: "Active",
    token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    ended_by: null,
    ...overrides,
  };
}

describe("Vault runway calculation (#22)", () => {
  it("returns null when balance or mandates is null", () => {
    expect(computeVaultRunway(null, [])).toBeNull();
    expect(computeVaultRunway(10_000_000n, null)).toBeNull();
  });

  it("handles accounts with no active mandates", () => {
    const paused = mockMandate({ status: "Paused" });
    const cancelled = mockMandate({ id: 2, status: "Cancelled" });
    const res = computeVaultRunway(100_000_000n, [paused, cancelled]);

    expect(res).toEqual({
      chargesCovered: 0,
      runsOutDate: null,
      isLow: false,
      activeMandatesCount: 0,
      hasActiveMandates: false,
    });
  });

  it("calculates runway for open-ended mandates with insufficient funds", () => {
    const mandate = mockMandate({
      amount: "10000000", // 10 stroops
      next_charge: 1700000000,
      period: 86400,
    });

    // 0 balance
    const zeroRes = computeVaultRunway(0n, [mandate]);
    expect(zeroRes).not.toBeNull();
    expect(zeroRes?.chargesCovered).toBe(0);
    expect(zeroRes?.runsOutDate).toBe(1700000000);
    expect(zeroRes?.isLow).toBe(true);

    // Can only cover 1 charge
    const oneRes = computeVaultRunway(10_000_000n, [mandate]);
    expect(oneRes?.chargesCovered).toBe(1);
    expect(oneRes?.runsOutDate).toBe(1700000000 + 86400);
    expect(oneRes?.isLow).toBe(true); // < 2 charges is low
  });

  it("calculates runway for open-ended mandates with multiple charges covered", () => {
    const mandate = mockMandate({
      amount: "10000000",
      next_charge: 1700000000,
      period: 86400,
    });

    // 3 charges covered
    const res = computeVaultRunway(30_000_000n, [mandate]);
    expect(res?.chargesCovered).toBe(3);
    expect(res?.runsOutDate).toBe(1700000000 + 3 * 86400);
    expect(res?.isLow).toBe(false);
  });

  it("handles capped mandates where balance fully covers all remaining charges", () => {
    const capped = mockMandate({
      amount: "10000000",
      next_charge: 1700000000,
      period: 86400,
      max_charges: 5,
      charges_made: 2, // 3 remaining charges = 30_000_000 stroops
    });

    // Vault has 50_000_000 stroops, which is more than enough for all 3 remaining charges
    const res = computeVaultRunway(50_000_000n, [capped]);
    expect(res?.chargesCovered).toBe(3);
    expect(res?.runsOutDate).toBeNull(); // Indefinite / fully funded through mandate end!
    expect(res?.isLow).toBe(false);
  });

  it("handles capped mandates where balance covers fewer than all remaining charges", () => {
    const capped = mockMandate({
      amount: "10000000",
      next_charge: 1700000000,
      period: 86400,
      max_charges: 5,
      charges_made: 2, // 3 remaining
    });

    // Vault has 15_000_000 stroops (covers only 1 charge)
    const res = computeVaultRunway(15_000_000n, [capped]);
    expect(res?.chargesCovered).toBe(1);
    expect(res?.runsOutDate).toBe(1700000000 + 86400);
    expect(res?.isLow).toBe(true);
  });

  it("interleaves charges chronologically across multiple active mandates", () => {
    // Mandate 1: 10 stroops due at t=100 and t=200
    const m1 = mockMandate({
      id: 1,
      amount: "10000000",
      next_charge: 100,
      period: 100,
    });

    // Mandate 2: 20 stroops due at t=150 and t=250
    const m2 = mockMandate({
      id: 2,
      amount: "20000000",
      next_charge: 150,
      period: 100,
    });

    // Sequence of charges:
    // t=100: m1 (10) -> cumulative 10
    // t=150: m2 (20) -> cumulative 30
    // t=200: m1 (10) -> cumulative 40
    // t=250: m2 (20) -> cumulative 60

    // With balance 35:
    // t=100 covered (rem 25)
    // t=150 covered (rem 5)
    // t=200 fails! (needs 10, only 5 left)
    const res = computeVaultRunway(35_000_000n, [m1, m2]);
    expect(res?.chargesCovered).toBe(2);
    expect(res?.runsOutDate).toBe(200);
    expect(res?.isLow).toBe(false); // 2 is not < 2
  });

  it("applies discounts to upcoming charges", () => {
    // Mandate with 50% discount for first 2 charges
    const m = mockMandate({
      amount: "10000000", // 10 stroops normal
      discount_bps: 5000, // 50% discount -> 5 stroops
      discount_charges: 2,
      discount_charges_made: 0,
      next_charge: 100,
      period: 50,
    });

    // Charge 1: 5 stroops at t=100
    // Charge 2: 5 stroops at t=150
    // Charge 3: 10 stroops at t=200
    // Balance 12 stroops covers charge 1 and 2, but fails on charge 3 at t=200
    const res = computeVaultRunway(12_000_000n, [m]);
    expect(res?.chargesCovered).toBe(2);
    expect(res?.runsOutDate).toBe(200);
  });

  it("formats runway human-readable text correctly", () => {
    const formatDate = (t: number) => `t=${t}`;

    expect(
      formatRunway(
        {
          chargesCovered: 0,
          runsOutDate: 100,
          isLow: true,
          activeMandatesCount: 1,
          hasActiveMandates: true,
        },
        formatDate,
      ),
    ).toEqual({
      headline: "0 charges covered",
      detail: "Your balance cannot cover the next charge (due t=100). Deposit funds to keep subscriptions active.",
    });

    expect(
      formatRunway(
        {
          chargesCovered: 3,
          runsOutDate: null,
          isLow: false,
          activeMandatesCount: 1,
          hasActiveMandates: true,
        },
        formatDate,
      ),
    ).toEqual({
      headline: "Covers 3 charges",
      detail: "All scheduled charges are fully funded.",
    });

    expect(
      formatRunway(
        {
          chargesCovered: 5,
          runsOutDate: 500,
          isLow: false,
          activeMandatesCount: 2,
          hasActiveMandates: true,
        },
        formatDate,
      ),
    ).toEqual({
      headline: "Covers 5 charges",
      detail: "Runs out on t=500 when the next charge falls due.",
    });
  });
});
