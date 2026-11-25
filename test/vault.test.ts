import { describe, expect, it } from "vitest";
import { vaultCommitment } from "@/lib/vault";
import type { ApiMandate } from "@/lib/api";

const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

function mandate(overrides: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 1,
    subscriber: "GSUBSCRIBER",
    merchant: "GMERCHANT",
    plan_id: 1,
    amount: "10000000",
    period: 2_592_000,
    next_charge: 0,
    last_charge: 0,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
    ended_by: null,
    token: XLM,
    ...overrides,
  };
}

describe("vault commitment split (#298)", () => {
  it("returns null while the balance or mandates are loading", () => {
    expect(vaultCommitment(null, [mandate()], XLM)).toBeNull();
    expect(vaultCommitment(100n, null, XLM)).toBeNull();
  });

  it("commits the next charge of each active mandate and leaves the rest free", () => {
    const split = vaultCommitment(
      50_000_000n,
      [mandate({ id: 1 }), mandate({ id: 2 })],
      XLM,
    );
    expect(split).toEqual({
      committed: 20_000_000n,
      free: 30_000_000n,
      shortfall: 0n,
      activeCount: 2,
    });
  });

  it("ignores paused, cancelled and completed mandates", () => {
    const split = vaultCommitment(
      50_000_000n,
      [
        mandate({ id: 1, status: "Active" }),
        mandate({ id: 2, status: "Paused" }),
        mandate({ id: 3, status: "Cancelled" }),
        mandate({ id: 4, status: "Completed" }),
        // Contract state can decode the enum as a one-item vector.
        mandate({ id: 5, status: ["Active"] as unknown as string }),
      ],
      XLM,
    );
    expect(split?.committed).toBe(20_000_000n);
    expect(split?.activeCount).toBe(2);
  });

  it("does not commit another token's mandate against this vault", () => {
    const split = vaultCommitment(
      50_000_000n,
      [mandate({ token: XLM }), mandate({ id: 2, token: USDC })],
      XLM,
    );
    expect(split?.committed).toBe(10_000_000n);
    expect(split?.activeCount).toBe(1);
  });

  it("commits the discounted next charge while the discount runs", () => {
    const split = vaultCommitment(
      50_000_000n,
      [mandate({ discount_bps: 2000, discount_charges: 3, discount_charges_made: 1 })],
      XLM,
    );
    // 1 XLM at 20% off is 0.8 XLM.
    expect(split?.committed).toBe(8_000_000n);
  });

  it("falls back to the full price once the discount has run out", () => {
    const split = vaultCommitment(
      50_000_000n,
      [mandate({ discount_bps: 2000, discount_charges: 3, discount_charges_made: 3 })],
      XLM,
    );
    expect(split?.committed).toBe(10_000_000n);
  });

  it("reports a shortfall instead of a negative free balance", () => {
    const split = vaultCommitment(
      5_000_000n,
      [mandate({ id: 1 }), mandate({ id: 2 })],
      XLM,
    );
    expect(split?.committed).toBe(20_000_000n);
    expect(split?.free).toBe(0n);
    expect(split?.shortfall).toBe(15_000_000n);
  });

  it("leaves an empty or unreadable mandate list with nothing committed", () => {
    expect(vaultCommitment(50_000_000n, [], XLM)).toEqual({
      committed: 0n,
      free: 50_000_000n,
      shortfall: 0n,
      activeCount: 0,
    });
    const malformed = vaultCommitment(
      50_000_000n,
      [mandate({ amount: "not-a-number" })],
      XLM,
    );
    expect(malformed?.committed).toBe(0n);
    expect(malformed?.free).toBe(50_000_000n);
  });
});
