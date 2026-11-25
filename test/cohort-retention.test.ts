import { describe, expect, it } from "vitest";
import {
  describeCohortRetention,
  formatRetentionPercent,
  parseCohortRetention,
  retentionColorClass,
} from "@/lib/cohort-retention";

const MERCHANT = "GABC";

function cohort(
  month: string,
  size: number,
  retention: number[],
) {
  return { cohort: month, size, retention };
}

function response(cohorts: ReturnType<typeof cohort>[]) {
  return { merchant: MERCHANT, cohorts };
}

describe("parseCohortRetention", () => {
  it("parses cohort retention data with multiple months", () => {
    const body = response([
      cohort("2026-10", 12, [100, 91.7, 83.3, 75.0]),
      cohort("2026-11", 8, [100, 87.5, 75.0]),
    ]);

    const result = parseCohortRetention(body, MERCHANT);
    expect(result).toEqual({
      merchant: MERCHANT,
      cohorts: [
        { cohort: "2026-10", size: 12, retention: [100, 91.7, 83.3, 75.0] },
        { cohort: "2026-11", size: 8, retention: [100, 87.5, 75.0] },
      ],
      maxAge: 3,
    });
  });

  it("orders cohorts chronologically", () => {
    const body = response([
      cohort("2026-11", 5, [100, 80.0]),
      cohort("2026-09", 10, [100, 90.0, 80.0, 70.0]),
      cohort("2026-10", 8, [100, 87.5, 75.0]),
    ]);

    const result = parseCohortRetention(body, MERCHANT);
    expect(result?.cohorts.map((c) => c.cohort)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("calculates maxAge from the longest retention array", () => {
    const body = response([
      cohort("2026-09", 10, [100, 90.0, 80.0, 70.0, 60.0]),
      cohort("2026-10", 8, [100, 87.5]),
      cohort("2026-11", 5, [100]),
    ]);

    const result = parseCohortRetention(body, MERCHANT);
    expect(result?.maxAge).toBe(4);
  });

  it("accepts empty cohort list", () => {
    const body = response([]);
    const result = parseCohortRetention(body, MERCHANT);
    expect(result).toEqual({
      merchant: MERCHANT,
      cohorts: [],
      maxAge: 0,
    });
  });

  it("accepts zero-sized cohorts", () => {
    const body = response([cohort("2026-10", 0, [100])]);
    const result = parseCohortRetention(body, MERCHANT);
    expect(result?.cohorts[0]?.size).toBe(0);
  });

  it("rejects month 0 retention not equal to 100%", () => {
    const body = response([cohort("2026-10", 10, [99, 90, 80])]);
    expect(parseCohortRetention(body, MERCHANT)).toBeNull();
  });

  it("rejects retention percentages outside [0, 100]", () => {
    expect(
      parseCohortRetention(
        response([cohort("2026-10", 10, [100, 101])]),
        MERCHANT,
      ),
    ).toBeNull();
    expect(
      parseCohortRetention(
        response([cohort("2026-10", 10, [100, -5])]),
        MERCHANT,
      ),
    ).toBeNull();
  });

  it("rejects invalid month formats", () => {
    expect(
      parseCohortRetention(
        response([cohort("2026-13", 10, [100])]),
        MERCHANT,
      ),
    ).toBeNull();
    expect(
      parseCohortRetention(
        response([cohort("2026-00", 10, [100])]),
        MERCHANT,
      ),
    ).toBeNull();
    expect(
      parseCohortRetention(
        response([cohort("26-10", 10, [100])]),
        MERCHANT,
      ),
    ).toBeNull();
  });

  it("rejects duplicate cohort months", () => {
    const body = response([
      cohort("2026-10", 10, [100, 90]),
      cohort("2026-10", 5, [100, 80]),
    ]);
    expect(parseCohortRetention(body, MERCHANT)).toBeNull();
  });

  it("rejects negative cohort sizes", () => {
    const body = response([cohort("2026-10", -1, [100])]);
    expect(parseCohortRetention(body, MERCHANT)).toBeNull();
  });

  it("rejects non-integer cohort sizes", () => {
    const body = response([cohort("2026-10", 10.5, [100])]);
    expect(parseCohortRetention(body, MERCHANT)).toBeNull();
  });

  it.each([
    null,
    {},
    { merchant: MERCHANT },
    { merchant: "GOTHER", cohorts: [] },
    { merchant: MERCHANT, cohorts: "not an array" },
    { merchant: MERCHANT, cohorts: [{ cohort: "2026-10", size: 10 }] }, // missing retention
    { merchant: MERCHANT, cohorts: [{ cohort: "2026-10", retention: [100] }] }, // missing size
  ])("rejects malformed or incomplete backend response %#", (body) => {
    expect(parseCohortRetention(body, MERCHANT)).toBeNull();
  });
});

describe("formatRetentionPercent", () => {
  it("formats whole percentages without decimals", () => {
    expect(formatRetentionPercent(100)).toBe("100%");
    expect(formatRetentionPercent(75)).toBe("75%");
    expect(formatRetentionPercent(0)).toBe("0%");
  });

  it("formats fractional percentages with up to 1 decimal place", () => {
    expect(formatRetentionPercent(91.7)).toBe("91.7%");
    expect(formatRetentionPercent(83.3)).toBe("83.3%");
    expect(formatRetentionPercent(66.6)).toBe("66.6%");
  });

  it("removes trailing zeros from decimals", () => {
    expect(formatRetentionPercent(90.0)).toBe("90%");
    expect(formatRetentionPercent(50.0)).toBe("50%");
  });
});

describe("retentionColorClass", () => {
  it("returns the strongest accent tint for high retention (90%+)", () => {
    expect(retentionColorClass(100)).toBe("bg-accent/20");
    expect(retentionColorClass(90)).toBe("bg-accent/20");
  });

  it("returns a lighter accent tint for good retention (70-89%)", () => {
    expect(retentionColorClass(89)).toBe("bg-accent/10");
    expect(retentionColorClass(70)).toBe("bg-accent/10");
  });

  it("returns a warning tint for moderate retention (50-69%)", () => {
    expect(retentionColorClass(69)).toBe("bg-warn/10");
    expect(retentionColorClass(50)).toBe("bg-warn/10");
  });

  it("returns a stronger warning tint for low retention (30-49%)", () => {
    expect(retentionColorClass(49)).toBe("bg-warn/20");
    expect(retentionColorClass(30)).toBe("bg-warn/20");
  });

  it("returns a danger tint for very low retention (1-29%)", () => {
    expect(retentionColorClass(29)).toBe("bg-danger/10");
    expect(retentionColorClass(1)).toBe("bg-danger/10");
  });

  it("returns a neutral tint for zero retention", () => {
    expect(retentionColorClass(0)).toBe("bg-fg/5");
  });

  it("never returns a fixed palette colour that ignores the chosen theme", () => {
    for (const percent of [0, 1, 29, 30, 49, 50, 69, 70, 89, 90, 100]) {
      expect(retentionColorClass(percent)).not.toContain("dark:");
    }
  });
});

describe("describeCohortRetention", () => {
  it("summarises the cohorts, their subscribers and the month-1 spread", () => {
    expect(
      describeCohortRetention([
        cohort("2026-09", 10, [100, 90, 80]),
        cohort("2026-10", 8, [100, 75]),
      ]),
    ).toBe(
      "Cohort retention for 2 cohorts (signup months 2026-09 to 2026-10) covering 18 subscribers. Month 1 retention ranges from 75% to 90%.",
    );
  });

  it("says so when every cohort retained the same share", () => {
    expect(
      describeCohortRetention([
        cohort("2026-09", 10, [100, 80]),
        cohort("2026-10", 5, [100, 80]),
      ]),
    ).toBe(
      "Cohort retention for 2 cohorts (signup months 2026-09 to 2026-10) covering 15 subscribers. Month 1 retention is 80% across every cohort.",
    );
  });

  it("names a single cohort's month instead of a range", () => {
    expect(describeCohortRetention([cohort("2026-10", 1, [100, 50])])).toBe(
      "Cohort retention for 1 cohort (the 2026-10 signup month) covering 1 subscriber. Month 1 retention is 50% across every cohort.",
    );
  });

  it("does not call a cohort too new to be measured a zero", () => {
    expect(describeCohortRetention([cohort("2026-11", 4, [100])])).toBe(
      "Cohort retention for 1 cohort (the 2026-11 signup month) covering 4 subscribers. No cohort is old enough to report a second month yet.",
    );
  });

  it("explains an empty report instead of returning a fragment", () => {
    expect(describeCohortRetention([])).toBe("No signup cohorts have been reported yet.");
  });

  it("uses the caller's number format", () => {
    expect(
      describeCohortRetention([cohort("2026-10", 2, [100, 66.6])], (value) => `~${value}`),
    ).toContain("Month 1 retention is ~66.6 across every cohort.");
  });
});
