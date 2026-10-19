import { describe, expect, it } from "vitest";
import {
  buildChargeSchedule,
  chargeShortfall,
  UPCOMING_CHARGE_LIMIT,
  type SchedulableMandate,
} from "@/lib/schedule";

/**
 * The timeline is a pure projection of mandate state: dates come from the
 * contract's fixed second-count periods and amounts stay bigint throughout.
 * These tests pin the cases the account page relies on to decide whether to
 * render anything at all.
 */

const NEXT = 1_700_000_000; // 14 Nov 2023, 22:13:20 UTC
const MONTH = 2_592_000;

function mandate(overrides: Partial<SchedulableMandate> = {}): SchedulableMandate {
  return {
    status: "Active",
    amount: "10000000", // 1 XLM in stroops
    period: MONTH,
    next_charge: NEXT,
    charges_made: 0,
    max_charges: 0,
    ...overrides,
  };
}

describe("buildChargeSchedule", () => {
  it("returns the next six charges for an open-ended active mandate", () => {
    const schedule = buildChargeSchedule(mandate());

    expect(schedule.charges).toHaveLength(UPCOMING_CHARGE_LIMIT);
    expect(schedule.charges.map((c) => c.due)).toEqual(
      Array.from({ length: 6 }, (_, i) => NEXT + i * MONTH),
    );
    expect(schedule.charges.every((c) => c.amount === 10_000_000n)).toBe(true);
    expect(schedule.finalDate).toBeNull();
    expect(schedule.remaining).toBeNull();
  });

  it("keeps a running total in the smallest unit", () => {
    const schedule = buildChargeSchedule(mandate());

    expect(schedule.charges.map((c) => c.total)).toEqual([
      10_000_000n,
      20_000_000n,
      30_000_000n,
      40_000_000n,
      50_000_000n,
      60_000_000n,
    ]);
    expect(schedule.total).toBe(60_000_000n);
  });

  it("does not render paused, cancelled or completed mandates", () => {
    for (const status of ["Paused", "Cancelled", "Completed"]) {
      const schedule = buildChargeSchedule(mandate({ status }));
      expect(schedule.charges).toEqual([]);
      expect(schedule.total).toBe(0n);
    }
  });

  it("stops at the remaining charge cap and reports the final date", () => {
    const schedule = buildChargeSchedule(
      mandate({ max_charges: 3, charges_made: 1 }),
    );

    // Two charges left (3 - 1), not six.
    expect(schedule.charges).toHaveLength(2);
    expect(schedule.remaining).toBe(2);
    expect(schedule.finalDate).toBe(NEXT + MONTH);
    expect(schedule.total).toBe(20_000_000n);
  });

  it("reports the final date even when it is beyond the six shown", () => {
    const schedule = buildChargeSchedule(
      mandate({ max_charges: 10, charges_made: 0 }),
    );

    expect(schedule.charges).toHaveLength(6);
    // The tenth charge is the last one, whether or not it is on screen.
    expect(schedule.finalDate).toBe(NEXT + 9 * MONTH);
  });

  it("renders nothing for a capped mandate with no charges left", () => {
    const schedule = buildChargeSchedule(
      mandate({ max_charges: 2, charges_made: 2 }),
    );
    expect(schedule.charges).toEqual([]);
    expect(schedule.finalDate).toBeNull();
  });

  it("rejects malformed schedule data instead of inventing dates", () => {
    expect(buildChargeSchedule(mandate({ next_charge: 0 })).charges).toEqual([]);
    expect(buildChargeSchedule(mandate({ period: 0 })).charges).toEqual([]);
    expect(buildChargeSchedule(mandate({ amount: "0" })).charges).toEqual([]);
    expect(buildChargeSchedule(mandate({ amount: "not-a-number" })).charges).toEqual(
      [],
    );
  });

  it("honours a caller-supplied horizon", () => {
    expect(buildChargeSchedule(mandate(), 2).charges).toHaveLength(2);
  });

  it("applies a merchant discount to the charges it covers", () => {
    const schedule = buildChargeSchedule(
      mandate({
        discount_bps: 2_000, // 20% off
        discount_charges: 2,
        discount_charges_made: 0,
      }),
    );

    expect(schedule.charges.map((c) => c.amount)).toEqual([
      8_000_000n,
      8_000_000n,
      10_000_000n,
      10_000_000n,
      10_000_000n,
      10_000_000n,
    ]);
    // 2 discounted charges + 4 full-price charges.
    expect(schedule.total).toBe(56_000_000n);
  });

  it("keeps the full price when the discount counter is unavailable", () => {
    const schedule = buildChargeSchedule(
      mandate({ discount_bps: 2_000, discount_charges: 2 }),
    );

    expect(schedule.charges.every((c) => c.amount === 10_000_000n)).toBe(true);
  });
});

describe("chargeShortfall", () => {
  it("reports the exact shortfall in the smallest unit", () => {
    expect(chargeShortfall(4_000_000n, 10_000_000n)).toBe(6_000_000n);
  });

  it("returns null when the balance covers the charge", () => {
    expect(chargeShortfall(10_000_000n, 10_000_000n)).toBeNull();
    expect(chargeShortfall(50_000_000n, 10_000_000n)).toBeNull();
  });

  it("treats an unknown balance as not short", () => {
    expect(chargeShortfall(null, 10_000_000n)).toBeNull();
  });
});
