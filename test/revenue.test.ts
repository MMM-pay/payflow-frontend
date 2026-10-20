import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/format";
import {
  bucketSeconds,
  describeSeries,
  fillBuckets,
  floorToBucket,
  formatBucketLabel,
  peakNet,
  bestPoint,
  parseRevenue,
  scaleSeries,
  totalNet,
  toPolyline,
  type BucketSize,
} from "@/lib/revenue";

/**
 * The revenue endpoint does not exist yet (payflow-backend#12), so these tests
 * pin the contract the dashboard depends on rather than anything live:
 *
 * - `parseRevenue` tolerates the backend's shape but is strict about values: a
 *   bucket it cannot read is skipped, and a body it cannot parse is null,
 *   never an empty array. Null and [] mean different things to the page.
 * - Every sum and every scale factor stays bigint until the last pixel.
 * - Empty buckets are filled with real zeros so the line does not bridge a
 *   quiet stretch as if revenue accrued evenly through it.
 */

const DAY = 86_400;
const WEEK = 7 * DAY;
const NOW = 1_760_000_000;

function bucket(
  start: number | string,
  gross: string,
  fee: string,
  net: string,
): Record<string, unknown> {
  return { bucket: start, gross, fee, net };
}

describe("parseRevenue", () => {
  it("sorts and keeps every readable bucket", () => {
    expect(
      parseRevenue({
        buckets: [
          bucket(NOW + 2 * DAY, "6", "0", "6"),
          bucket(NOW, "3", "1", "2"),
          bucket(NOW + DAY, "1", "0", "1"),
        ],
      }),
    ).toEqual([
      { start: NOW, gross: 3n, fee: 1n, net: 2n },
      { start: NOW + DAY, gross: 1n, fee: 0n, net: 1n },
      { start: NOW + 2 * DAY, gross: 6n, fee: 0n, net: 6n },
    ]);
  });

  it("reads an ISO date as UTC midnight, not the reader's timezone", () => {
    const series = parseRevenue({ buckets: [bucket("2026-10-12", "1", "0", "1")] });
    expect(series).toHaveLength(1);
    // 2026-10-12T00:00:00Z
    expect(series![0]!.start).toBe(1_791_763_200);
  });

  it("accepts unix seconds", () => {
    const series = parseRevenue({ buckets: [bucket(1_760_000_000, "1", "0", "1")] });
    expect(series?.[0]?.start).toBe(1_760_000_000);
  });

  it("accepts start as an alias for bucket", () => {
    const series = parseRevenue({ buckets: [{ start: NOW, gross: "3", fee: "1", net: "2" }] });
    expect(series![0]!.start).toBe(NOW);
  });

  it("skips a bucket any figure cannot parse", () => {
    const body = {
      buckets: [
        bucket(NOW, "3", "1", "2"),
        { bucket: NOW + DAY, gross: "one", fee: "0", net: "1" },
        bucket(NOW + 2 * DAY, "5", "0", "5"),
      ],
    };
    expect(parseRevenue(body)).toEqual([
      { start: NOW, gross: 3n, fee: 1n, net: 2n },
      { start: NOW + 2 * DAY, gross: 5n, fee: 0n, net: 5n },
    ]);
  });

  it("returns null for a body it cannot read at all", () => {
    expect(parseRevenue(null)).toBeNull();
    expect(parseRevenue({})).toBeNull();
    expect(parseRevenue({ buckets: "not an array" })).toBeNull();
    expect(parseRevenue({ buckets: [{ gross: "1" }] })).toEqual([]);
    // ...but an empty buckets array is a real answer: no revenue, not unknown.
    expect(parseRevenue({ buckets: [] })).toEqual([]);
  });

  it("does not crash on a bucket that is not an object", () => {
    expect(parseRevenue({ buckets: [null, "nope", bucket(NOW, "1", "0", "1")] })).toEqual([
      { start: NOW, gross: 1n, fee: 0n, net: 1n },
    ]);
  });

  it("ignores floats and signs, which are not smallest-unit strings", () => {
    const body = {
      buckets: [
        bucket(NOW, "3.5", "1", "2"),
        bucket(NOW + DAY, "-1", "1", "0"),
        bucket(NOW + 2 * DAY, "1", "0", "1"),
      ],
    };
    expect(parseRevenue(body)).toEqual([{ start: NOW + 2 * DAY, gross: 1n, fee: 0n, net: 1n }]);
  });
});

describe("bucketSeconds / floorToBucket", () => {
  it("keeps day-sized steps for daily buckets, aligned to UTC midnight", () => {
    expect(bucketSeconds("day")).toBe(DAY);
    for (const t of [NOW, NOW + DAY, NOW + 3 * DAY, NOW + 10 * DAY]) {
      const f = floorToBucket(t, "day");
      expect(f % DAY).toBe(0);
      expect(floorToBucket(f, "day")).toBe(f);
    }
  });

  it("keeps week-sized steps for weekly buckets, aligned to UTC midnight", () => {
    expect(bucketSeconds("week")).toBe(WEEK);
    for (const t of [NOW, NOW + DAY, NOW + 3 * DAY, NOW + 10 * DAY]) {
      const f = floorToBucket(t, "week");
      expect(f % WEEK).toBe(0);
      expect(floorToBucket(f, "week")).toBe(f);
    }
  });
});

describe("fillBuckets", () => {
  it("inserts real zeros where the API reported nothing", () => {
    const from = floorToBucket(NOW, "day");
    const series = fillBuckets(
      [
        { start: from, gross: 3n, fee: 1n, net: 2n },
        { start: from + 3 * DAY, gross: 1n, fee: 0n, net: 1n },
      ],
      "day",
      from,
      from + 3 * DAY,
    );
    expect(series.map((p) => p.net)).toEqual([2n, 0n, 0n, 1n]);
    expect(series.map((p) => p.gross)).toEqual([3n, 0n, 0n, 1n]);
    expect(series.map((p) => p.start)).toEqual([from, from + DAY, from + 2 * DAY, from + 3 * DAY]);
  });

  it("keeps nothing as nothing", () => {
    expect(fillBuckets([], "day", NOW, NOW + DAY)).toEqual([]);
  });
});

describe("totalNet / peakNet / bestPoint", () => {
  it("sum every bucket's net", () => {
    expect(
      totalNet([
        { start: NOW, gross: 3n, fee: 1n, net: 2n },
        { start: NOW + DAY, gross: 10n, fee: 1n, net: 9n },
      ]),
    ).toBe(11n);
  });

  it("peaks at the largest net and names its bucket", () => {
    const series = [
      { start: NOW, gross: 3n, fee: 1n, net: 2n },
      { start: NOW + DAY, gross: 10n, fee: 1n, net: 9n },
      { start: NOW + 2 * DAY, gross: 5n, fee: 0n, net: 5n },
    ];
    expect(peakNet(series)).toBe(9n);
    expect(bestPoint(series)).toEqual({ start: NOW + DAY, gross: 10n, fee: 1n, net: 9n });
    expect(bestPoint([])).toBeNull();
  });
});

describe("scaleSeries", () => {
  it("scales every amount in bigint until the last pixel", () => {
    const series = [
      { start: NOW, gross: 0n, fee: 0n, net: 0n },
      { start: NOW + DAY, gross: 100n, fee: 0n, net: 100n },
    ];
    const points = scaleSeries(series, 100, 100);
    expect(points.length).toBe(2);
    // Max sits at the bottom padding, zero at the top padding.
    expect(points[0]!.y).toBeGreaterThan(points[1]!.y);
    expect(points[0]!.y).toBe(100 - 4);
    expect(points[1]!.y).toBe(4);
  });

  it("spreads points evenly across the width", () => {
    const series = [
      { start: NOW, gross: 1n, fee: 0n, net: 1n },
      { start: NOW + DAY, gross: 1n, fee: 0n, net: 1n },
      { start: NOW + 2 * DAY, gross: 1n, fee: 0n, net: 1n },
    ];
    const points = scaleSeries(series, 100, 100);
    expect(points.map((p) => p.x)).toEqual([0, 50, 100]);
  });

  it("centres a single point rather than dividing by zero", () => {
    expect(scaleSeries([{ start: NOW, gross: 1n, fee: 0n, net: 1n }], 100, 100)).toEqual([
      { x: 50, y: 4 },
    ]);
  });

  it("draws an all-zero series along the floor", () => {
    const points = scaleSeries(
      [
        { start: NOW, gross: 0n, fee: 0n, net: 0n },
        { start: NOW + DAY, gross: 0n, fee: 0n, net: 0n },
      ],
      100,
      100,
    );
    expect(points.map((p) => p.y)).toEqual([96, 96]);
  });

  it("never lets a negative bucket draw outside the frame", () => {
    const points = scaleSeries(
      [
        { start: NOW, gross: 0n, fee: 0n, net: -5n },
        { start: NOW + DAY, gross: 10n, fee: 0n, net: 10n },
      ],
      100,
      100,
    );
    expect(points.map((p) => p.y)).toEqual([96, 4]);
  });
});

describe("toPolyline", () => {
  it("forms a polyline points string", () => {
    expect(toPolyline([{ x: 0, y: 0 }, { x: 50, y: 10 }])).toBe("0,0 50,10");
  });
});

describe("formatBucketLabel", () => {
  it("shows day and month, not a weekday name", () => {
    // 2026-10-12 is a Monday; nothing in the label should say so.
    expect(formatBucketLabel(1_791_763_200)).toBe("12 Oct");
  });
});

describe("describeSeries", () => {
  const render = (value: bigint) => `${Number(value)} XLM`;

  it("names the range, total and peak", () => {
    const series = [
      { start: NOW, gross: 10n, fee: 0n, net: 10n },
      { start: NOW + DAY, gross: 30n, fee: 3n, net: 27n },
    ];
    const text = describeSeries(series, "day", render);
    expect(text).toMatch(/Net revenue by day/);
    expect(text).toContain("total 37 XLM");
    expect(text).toMatch(/peak 27 XLM/);
    expect(text).toContain(formatDate(NOW));
    expect(text).toContain(formatDate(NOW + DAY));
  });

  it("says nothing was recorded for an empty series", () => {
    expect(describeSeries([], "day", render)).toBe("No revenue recorded in this period.");
  });
});

describe("weekly scaling", () => {
  it("groups seven days into one point", () => {
    const size: BucketSize = "week";
    expect(bucketSeconds(size)).toBe(WEEK);
  });
});