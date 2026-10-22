import { describe, expect, it } from "vitest";
import {
  checkDiscountBps,
  checkDiscountCharges,
  discountedAmount,
  discountBadge,
  discountBps,
  discountCharges,
  discountLabel,
  formatDiscountBps,
  MAX_DISCOUNT_BPS,
  nextChargeAmount,
  remainingDiscountCharges,
  supportsDiscounts,
} from "@/lib/discount";
import { XLM } from "@/lib/format";

/**
 * Merchant discounts on a mandate (issue #115).
 *
 * Two things have to hold: a discount can never raise what the subscriber
 * pays, and the rate is a whole number of basis points. The second one is
 * not a detail — the contract stores basis points, so a rate of 12.5% has to
 * arrive as exactly 1250, and "12.5 * 100" in floating point is
 * 1250.0000000000002.
 */

describe("checkDiscountBps", () => {
  it("reads a whole percentage", () => {
    expect(checkDiscountBps("20")).toEqual({ ok: true, bps: 2000 });
    expect(checkDiscountBps(" 20 ")).toEqual({ ok: true, bps: 2000 });
    expect(checkDiscountBps("1")).toEqual({ ok: true, bps: 100 });
  });

  it("reads a percentage with decimals exactly", () => {
    expect(checkDiscountBps("12.5")).toEqual({ ok: true, bps: 1250 });
    expect(checkDiscountBps("12.50")).toEqual({ ok: true, bps: 1250 });
    expect(checkDiscountBps("0.01")).toEqual({ ok: true, bps: 1 });
  });

  it("rejects a rate that is not a whole number of basis points", () => {
    expect(checkDiscountBps("12.555").ok).toBe(false);
  });

  it("keeps the rate inside the range a discount can have", () => {
    expect(checkDiscountBps("99.99")).toEqual({ ok: true, bps: MAX_DISCOUNT_BPS });
    expect(checkDiscountBps("100").ok).toBe(false);
    expect(checkDiscountBps("120").ok).toBe(false);
    expect(checkDiscountBps("0").ok).toBe(false);
  });

  it("rejects anything that is not a percentage", () => {
    for (const raw of ["", "   ", "abc", "-5", "1e3", "12,5", "12.5.5", "20%"]) {
      expect(checkDiscountBps(raw).ok, raw).toBe(false);
    }
  });

  it("explains what a discount of zero is", () => {
    expect(checkDiscountBps("0")).toMatchObject({
      message: "A discount must be greater than zero.",
    });
  });

  it("explains that a discount cannot be a hundred percent", () => {
    expect(checkDiscountBps("100")).toMatchObject({
      message: "A discount cannot be 100% or more.",
    });
  });
});

describe("checkDiscountCharges", () => {
  it("reads a whole number of charges", () => {
    expect(checkDiscountCharges("3")).toEqual({ ok: true, charges: 3 });
    expect(checkDiscountCharges(" 12 ")).toEqual({ ok: true, charges: 12 });
  });

  it("rejects a number of charges that is not a whole number", () => {
    for (const raw of ["", "abc", "1.5", "-2", "3 charges"]) {
      expect(checkDiscountCharges(raw).ok, raw).toBe(false);
    }
  });

  it("rejects a discount that covers no charge at all", () => {
    expect(checkDiscountCharges("0")).toMatchObject({
      message: "A discount must cover at least one charge.",
    });
  });
});

describe("discountedAmount", () => {
  it("takes the discount off in the token's smallest unit", () => {
    // 1 XLM, 20% off.
    expect(discountedAmount(10_000_000n, 2000)).toBe(8_000_000n);
    expect(discountedAmount(10_000_000n, 1250)).toBe(8_750_000n);
  });

  it("never charges more than the full price", () => {
    for (const bps of [0, 1, 500, 2000, 5000, 9999]) {
      expect(discountedAmount(10_000_000n, bps), String(bps)).toBeLessThanOrEqual(
        10_000_000n,
      );
    }
  });

  it("clamps a rate that is out of range", () => {
    // 100% and more is not a discount the contract accepts, so the rate is
    // clamped to the largest one it does: 99.99%.
    expect(discountedAmount(10_000_000n, 100_000)).toBe(1_000n);
    expect(discountedAmount(10_000_000n, -100)).toBe(10_000_000n);
  });

  it("rounds down like the contract does", () => {
    // 99.99% off 99 stroops leaves a fraction of a stroop, which is nothing.
    expect(discountedAmount(99n, 9999)).toBe(0n);
    expect(discountedAmount(1_000_000n, 3333)).toBe(666_700n);
  });
});

describe("formatDiscountBps", () => {
  it("reads as a percentage", () => {
    expect(formatDiscountBps(2000)).toBe("20%");
    expect(formatDiscountBps(1250)).toBe("12.5%");
    expect(formatDiscountBps(100)).toBe("1%");
    expect(formatDiscountBps(0)).toBe("0%");
  });
});

describe("supportsDiscounts", () => {
  it("is answered by the data, not by a flag", () => {
    expect(supportsDiscounts({ discount_bps: 2000 })).toBe(true);
    expect(supportsDiscounts({ discount_bps: 0 })).toBe(true);
    expect(supportsDiscounts({})).toBe(false);
    expect(supportsDiscounts(null)).toBe(false);
  });
});

describe("reading a discount off a mandate", () => {
  it("reads the rate and the number of charges", () => {
    expect(discountBps({ discount_bps: 2000 })).toBe(2000);
    expect(discountCharges({ discount_charges: 3 })).toBe(3);
  });

  it("reads a rate the contract sends as a bigint", () => {
    expect(discountBps({ discount_bps: 2000n })).toBe(2000);
    expect(discountCharges({ discount_charges: 3n })).toBe(3);
  });

  it("treats a missing field as no discount rather than as a number", () => {
    expect(discountBps({})).toBe(0);
    expect(discountCharges({})).toBe(0);
  });

  it("counts the discounted charges that are left", () => {
    expect(
      remainingDiscountCharges({ discount_bps: 2000, discount_charges: 3, discount_charges_made: 1 }),
    ).toBe(2);
    expect(
      remainingDiscountCharges({ discount_bps: 2000, discount_charges: 3, discount_charges_made: 3 }),
    ).toBe(0);
    expect(
      remainingDiscountCharges({ discount_bps: 2000, discount_charges: 3, discount_charges_made: 9 }),
    ).toBe(0);
  });

  it("does not claim a remainder it cannot know", () => {
    // A contract that carries the rate but not the count cannot say.
    expect(remainingDiscountCharges({ discount_bps: 2000, discount_charges: 3 })).toBeNull();
    // A contract without the fields at all cannot say either.
    expect(remainingDiscountCharges({})).toBeNull();
  });
});

describe("discountLabel", () => {
  it("says what the discount is", () => {
    expect(discountLabel(2000, 3)).toBe("20% off for 3 charges");
    expect(discountLabel(1250, 1)).toBe("12.5% off the next charge");
  });
});

describe("discountBadge", () => {
  it("is there when the mandate carries a discount", () => {
    expect(discountBadge({ discount_bps: 2000, discount_charges: 3 })).toBe(
      "20% off for 3 charges",
    );
  });

  it("is nothing when the mandate has no discount", () => {
    expect(discountBadge({})).toBeNull();
    expect(discountBadge({ discount_bps: 0, discount_charges: 3 })).toBeNull();
    expect(discountBadge({ discount_bps: 2000 })).toBeNull();
    expect(discountBadge(null)).toBeNull();
  });
});

describe("nextChargeAmount", () => {
  it("is what the subscriber pays while the discount runs", () => {
    expect(
      nextChargeAmount({
        amount: "10000000",
        discount_bps: 2000,
        discount_charges: 3,
        discount_charges_made: 1,
      }),
    ).toBe(8_000_000n);
  });

  it("is the full price once the discount has run out", () => {
    expect(
      nextChargeAmount({
        amount: "10000000",
        discount_bps: 2000,
        discount_charges: 3,
        discount_charges_made: 3,
      }),
    ).toBeNull();
  });

  it("is nothing when the mandate has no discount", () => {
    expect(nextChargeAmount({ amount: "10000000" })).toBeNull();
  });

  it("is nothing when the remainder cannot be known", () => {
    expect(
      nextChargeAmount({ amount: "10000000", discount_bps: 2000, discount_charges: 3 }),
    ).toBeNull();
  });
});

describe("the token's own scale", () => {
  it("does not change the arithmetic", () => {
    // A 6-decimal token: the discount is still a share of the smallest unit.
    expect(discountedAmount(1_000_000n, 2000)).toBe(800_000n);
    expect(XLM.decimals).toBe(7);
  });
});
