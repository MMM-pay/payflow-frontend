import { describe, expect, it } from "vitest";
import type { ApiMandate } from "@/lib/api";
import {
  MONTH_SECONDS,
  buildMrrTrend,
  monthStart,
  monthStarts,
  monthlyCommitment,
  mrrChange,
  peakMrr,
  scaleMrrSeries,
  shiftMonth,
} from "@/lib/mrr";

const NOW = Date.UTC(2026, 10, 15, 12) / 1000; // 15 Nov 2026, UTC

function mandate(overrides: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 1,
    subscriber: "GSUBSCRIBER",
    merchant: "GMERCHANT",
    plan_id: 1,
    amount: "10000000",
    period: MONTH_SECONDS,
    next_charge: 0,
    last_charge: 0,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
    ...overrides,
  };
}

describe("monthly commitment", () => {
  it("normalises every billing period to a 30-day month without floats", () => {
    expect(monthlyCommitment("10000000", MONTH_SECONDS)).toBe(10_000_000n);
    expect(monthlyCommitment("7000000", 604_800)).toBe(30_000_000n);
    expect(monthlyCommitment("86400000", 86_400)).toBe(2_592_000_000n);
    // A 90-day quarter of 30 XLM is 10 XLM a month.
    expect(monthlyCommitment("300000000", 2_592_000 * 3)).toBe(100_000_000n);
  });

  it("returns null for terms it cannot read instead of zero", () => {
    expect(monthlyCommitment("", MONTH_SECONDS)).toBeNull();
    expect(monthlyCommitment("1.5", MONTH_SECONDS)).toBeNull();
    expect(monthlyCommitment("abc", MONTH_SECONDS)).toBeNull();
    expect(monthlyCommitment("100", 0)).toBeNull();
    expect(monthlyCommitment("100", Number.NaN)).toBeNull();
    expect(monthlyCommitment("0", MONTH_SECONDS)).toBe(0n);
  });
});

describe("calendar buckets", () => {
  it("floors to UTC month boundaries across year changes", () => {
    expect(monthStart(NOW)).toBe(Date.UTC(2026, 10, 1) / 1000);
    expect(shiftMonth(Date.UTC(2026, 0, 1) / 1000, -1)).toBe(
      Date.UTC(2025, 11, 1) / 1000,
    );
    expect(shiftMonth(Date.UTC(2026, 11, 1) / 1000, 1)).toBe(
      Date.UTC(2027, 0, 1) / 1000,
    );
  });

  it("returns the requested window oldest first, ending with the current month", () => {
    expect(monthStarts(NOW, 3)).toEqual([
      Date.UTC(2026, 8, 1) / 1000,
      Date.UTC(2026, 9, 1) / 1000,
      Date.UTC(2026, 10, 1) / 1000,
    ]);
    expect(monthStarts(NOW, 0)).toHaveLength(1);
  });
});

describe("committed MRR trend", () => {
  it("shows growth as each mandate starts charging", () => {
    const trend = buildMrrTrend(
      [
        // 1 XLM a month, charged Aug, Sep and Oct.
        mandate({ id: 1, last_charge: Date.UTC(2026, 9, 15) / 1000, charges_made: 3 }),
        // 2 XLM a month, charged Oct only: starts in October.
        mandate({
          id: 2,
          amount: "20000000",
          last_charge: Date.UTC(2026, 9, 20) / 1000,
          charges_made: 1,
        }),
      ],
      NOW,
      6,
    );

    expect(trend).not.toBeNull();
    const monthly = trend!.points.map((point) => point.mrr);
    expect(monthly).toEqual([
      0n,
      0n,
      10_000_000n, // Aug
      10_000_000n, // Sep
      30_000_000n, // Oct: both mandates
      30_000_000n, // Nov: still active
    ]);
    expect(trend!.points.at(-1)!.mandates).toBe(2);
    // Both starts came from charge history, so nothing was inferred.
    expect(trend!.estimated).toBe(false);
  });

  it("stops counting a mandate after its final charge", () => {
    const trend = buildMrrTrend(
      [
        mandate({
          id: 3,
          amount: "5000000",
          status: "Cancelled",
          charges_made: 2,
          last_charge: Date.UTC(2026, 8, 10) / 1000,
        }),
      ],
      NOW,
      6,
    );

    expect(trend!.points.map((point) => point.mrr)).toEqual([
      0n,
      0n,
      5_000_000n, // Aug
      5_000_000n, // Sep: the month of the last charge
      0n,
      0n,
    ]);
  });

  it("flags a start inferred from the next due date and counts it only recently", () => {
    const trend = buildMrrTrend(
      [
        mandate({
          id: 4,
          next_charge: Date.UTC(2026, 10, 20) / 1000,
          charges_made: 0,
        }),
      ],
      NOW,
      3,
    );

    expect(trend!.estimated).toBe(true);
    // The commitment starts when the period before the next due date began.
    expect(trend!.points.map((point) => point.mrr)).toEqual([
      0n,
      10_000_000n,
      10_000_000n,
    ]);
  });

  it("treats an empty mandate list as a zero series, not an error", () => {
    const trend = buildMrrTrend([], NOW, 4);
    expect(trend).not.toBeNull();
    expect(trend!.points).toHaveLength(4);
    expect(peakMrr(trend!.points)).toBe(0n);
    expect(trend!.estimated).toBe(false);
  });

  it("returns null when mandates exist but none of their terms can be read", () => {
    expect(buildMrrTrend([mandate({ amount: "not-a-number" })], NOW)).toBeNull();
    expect(buildMrrTrend([mandate({ period: 0 })], NOW)).toBeNull();
  });

  it("skips a zero-amount mandate while still charting the readable ones", () => {
    const trend = buildMrrTrend(
      [
        mandate({ id: 5, amount: "0", last_charge: Date.UTC(2026, 8, 15) / 1000, charges_made: 1 }),
        mandate({ id: 6, last_charge: Date.UTC(2026, 8, 15) / 1000, charges_made: 1 }),
      ],
      NOW,
      2,
    );
    expect(trend!.points.map((point) => point.mrr)).toEqual([
      10_000_000n,
      10_000_000n,
    ]);
  });
});

describe("chart helpers", () => {
  it("computes signed change and a percentage in bigint", () => {
    expect(mrrChange(30_000_000n, 20_000_000n)).toEqual({
      delta: 10_000_000n,
      percent: 50,
    });
    expect(mrrChange(10_000_000n, 20_000_000n)).toEqual({
      delta: -10_000_000n,
      percent: -50,
    });
    expect(mrrChange(5n, 0n)).toEqual({ delta: 5n, percent: null });
    expect(mrrChange(-5n, 0n)).toEqual({ delta: -5n, percent: null });
  });

  it("places points on the line and clamps an all-zero series to the floor", () => {
    const points = [
      { start: 1, mrr: 5n, mandates: 1 },
      { start: 2, mrr: 10n, mandates: 1 },
      { start: 3, mrr: 0n, mandates: 0 },
    ];
    expect(scaleMrrSeries(points, 100, 50, 5)).toEqual([
      { x: 0, y: 25 },
      { x: 50, y: 5 },
      { x: 100, y: 45 },
    ]);
    expect(scaleMrrSeries([{ start: 1, mrr: 0n, mandates: 0 }], 100, 50, 5)).toEqual([
      { x: 50, y: 45 },
    ]);
    expect(scaleMrrSeries([], 100, 50)).toEqual([]);
  });
});
