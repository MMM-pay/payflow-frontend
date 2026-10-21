import { describe, expect, it } from "vitest";
import { parseMerchantChurn } from "@/lib/churn";

const MERCHANT = "GABC";

function month(
  bucket: string,
  counts: {
    started: number;
    cancelled: number;
    ended: number;
    completed: number;
    net: number;
  },
) {
  return { bucket, ...counts };
}

function response(buckets: ReturnType<typeof month>[]) {
  const totals = buckets.reduce(
    (sum, row) => ({
      started: sum.started + row.started,
      cancelled: sum.cancelled + row.cancelled,
      ended: sum.ended + row.ended,
      completed: sum.completed + row.completed,
      net: sum.net + row.net,
    }),
    { started: 0, cancelled: 0, ended: 0, completed: 0, net: 0 },
  );
  return { merchant: MERCHANT, bucket: "month", buckets, totals };
}

describe("parseMerchantChurn", () => {
  it("parses start, cancellation, merchant-ending, completion and net counts", () => {
    const body = response([
      month("2026-10", { started: 12, cancelled: 3, ended: 2, completed: 1, net: 6 }),
    ]);

    expect(parseMerchantChurn(body, MERCHANT)).toEqual([
      { bucket: "2026-10", started: 12, cancelled: 3, ended: 2, completed: 1, net: 6 },
    ]);
  });

  it("uses the backend net definition, subtracting all mandate departures", () => {
    const valid = response([
      month("2026-10", { started: 5, cancelled: 1, ended: 1, completed: 1, net: 2 }),
    ]);
    expect(parseMerchantChurn(valid, MERCHANT)?.[0]?.net).toBe(2);

    const inconsistent = {
      ...valid,
      buckets: [month("2026-10", { started: 5, cancelled: 1, ended: 1, completed: 1, net: 3 })],
      totals: { ...valid.totals, net: 3 },
    };
    expect(parseMerchantChurn(inconsistent, MERCHANT)).toBeNull();
  });

  it("orders multiple months chronologically", () => {
    const body = response([
      month("2026-11", { started: 2, cancelled: 0, ended: 0, completed: 0, net: 2 }),
      month("2026-09", { started: 1, cancelled: 0, ended: 0, completed: 0, net: 1 }),
      month("2026-10", { started: 0, cancelled: 1, ended: 0, completed: 0, net: -1 }),
    ]);

    expect(parseMerchantChurn(body, MERCHANT)?.map((row) => row.bucket)).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
  });

  it("accepts empty reports and empty months without inventing rows", () => {
    expect(parseMerchantChurn(response([]), MERCHANT)).toEqual([]);
    expect(
      parseMerchantChurn(
        response([month("2026-10", { started: 0, cancelled: 0, ended: 0, completed: 0, net: 0 })]),
        MERCHANT,
      ),
    ).toHaveLength(1);
  });

  it.each([
    null,
    {},
    { merchant: MERCHANT, bucket: "month", buckets: [] },
    { ...response([]), merchant: "GOTHER" },
    { ...response([]), bucket: "day" },
    response([month("2026-13", { started: 0, cancelled: 0, ended: 0, completed: 0, net: 0 })]),
    response([month("2026-10", { started: -1, cancelled: 0, ended: 0, completed: 0, net: -1 })]),
    response([month("2026-10", { started: 1.5, cancelled: 0, ended: 0, completed: 0, net: 1.5 })]),
    {
      ...response([month("2026-10", { started: 1, cancelled: 0, ended: 0, completed: 0, net: 1 })]),
      totals: { started: 0, cancelled: 0, ended: 0, completed: 0, net: 0 },
    },
  ])("rejects malformed or incomplete backend response %#", (body) => {
    expect(parseMerchantChurn(body, MERCHANT)).toBeNull();
  });
});
