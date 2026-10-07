import { describe, expect, it } from "vitest";
import {
  DECIMALS,
  formatPeriod,
  formatWhen,
  fromStroops,
  shortAddress,
  toStroops,
} from "@/lib/format";

/**
 * These helpers sit on the money path: every amount a user types reaches a
 * contract through `toStroops`, and every amount read back from chain is shown
 * through `fromStroops`. A rounding or parsing bug here silently misprices a
 * mandate, so the round-trip and the rejection cases are tested explicitly.
 */

describe("toStroops", () => {
  it("converts whole numbers", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("0")).toBe(0n);
    expect(toStroops("100")).toBe(1_000_000_000n);
  });

  it("converts decimals at full precision", () => {
    expect(toStroops("2.5")).toBe(25_000_000n);
    expect(toStroops("0.99")).toBe(9_900_000n);
    // One stroop is the smallest representable unit.
    expect(toStroops("0.0000001")).toBe(1n);
  });

  it("tolerates surrounding whitespace", () => {
    expect(toStroops("  2.5  ")).toBe(25_000_000n);
  });

  it("pads fractional digits rather than truncating them", () => {
    // "0.1" must be 1_000_000 stroops, not 1.
    expect(toStroops("0.1")).toBe(1_000_000n);
    expect(toStroops("0.10")).toBe(1_000_000n);
  });

  it("rejects more than seven decimal places instead of silently rounding", () => {
    expect(() => toStroops("1.00000001")).toThrow(/decimal places/);
  });

  it("rejects anything that is not a positive decimal", () => {
    for (const bad of ["", " ", "abc", "-1", "1.2.3", "1e5", "1,5", ".5", "1."]) {
      expect(() => toStroops(bad), `"${bad}" must be rejected`).toThrow();
    }
  });

  it("never loses precision on large amounts", () => {
    // 1 billion XLM — far beyond Number.MAX_SAFE_INTEGER once scaled.
        const stroops = toStroops("1000000000");
    expect(stroops).toBe(10_000_000_000_000_000n);
    expect(stroops > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});

describe("fromStroops", () => {
  it("formats whole and fractional values", () => {
    expect(fromStroops("10000000")).toBe("1");
    expect(fromStroops("9900000")).toBe("0.99");
    expect(fromStroops("25000000")).toBe("2.5");
  });

  it("accepts bigint as well as string", () => {
    expect(fromStroops(9_900_000n)).toBe("0.99");
  });

  it("treats empty and invalid input as zero rather than throwing", () => {
    // Display code must never crash on a malformed API value.
    expect(fromStroops("")).toBe("0");
    expect(fromStroops("not-a-number")).toBe("0");
  });

  it("strips trailing zeros", () => {
    expect(fromStroops("1500000")).toBe("0.15");
    expect(fromStroops("20000000")).toBe("2");
  });

  it("truncates to the requested precision without rounding up", () => {
    // 0.19999999 displays as 0.1999 at 4dp — truncation, never 0.2.
    expect(fromStroops("1999999", 4)).toBe("0.1999");
    expect(fromStroops("1999999", 2)).toBe("0.19");
  });

  it("handles negative values", () => {
    expect(fromStroops(-9_900_000n)).toBe("-0.99");
  });

  it("round-trips with toStroops", () => {
    // Every value a user can type must survive the trip to chain and back.
    for (const amount of ["0", "1", "0.99", "2.5", "1000", "0.0001", "0.0000001"]) {
      expect(fromStroops(toStroops(amount), DECIMALS), `round-trip of ${amount}`).toBe(amount);
    }
  });

  it("shows sub-display amounts as 0 rather than empty", () => {
    // One stroop is below 4dp display precision.
    expect(fromStroops("1", 4)).toBe("0");
  });
});

describe("formatPeriod", () => {
  it("names exact single periods", () => {
    expect(formatPeriod(60)).toBe("per minute");
    expect(formatPeriod(3_600)).toBe("per hour");
    expect(formatPeriod(86_400)).toBe("per day");
    expect(formatPeriod(604_800)).toBe("per week");
    expect(formatPeriod(2_592_000)).toBe("per month");
    expect(formatPeriod(31_536_000)).toBe("per year");
  });

  it("pluralises exact multiples", () => {
    expect(formatPeriod(120)).toBe("every 2 minutes");
    expect(formatPeriod(172_800)).toBe("every 2 days");
  });

  it("picks the largest unit that divides evenly", () => {
    // 2 weeks divides by week, not by day.
    expect(formatPeriod(1_209_600)).toBe("every 2 weeks");
  });

  it("falls back to seconds when no unit divides evenly", () => {
    expect(formatPeriod(90)).toBe("every 90s");
    expect(formatPeriod(1)).toBe("every 1s");
  });
});

describe("shortAddress", () => {
  const G = "GAEWDXVDI3WI35TWTZXNQ4NTRYIG6J34XPRSNKX655LBA377M5ZOCBY5";

  it("elides the middle of a Stellar address", () => {
    expect(shortAddress(G)).toBe("GAEW…CBY5");
    expect(shortAddress(G, 6)).toBe("GAEWDX…5ZOCBY5".slice(0, 6) + "…" + G.slice(-6));
  });

  it("leaves short strings untouched", () => {
    expect(shortAddress("GABC")).toBe("GABC");
  });
});

describe("formatWhen", () => {
  const now = Date.now();
  const at = (deltaMs: number) => Math.floor((now + deltaMs) / 1000);

  it("renders a missing timestamp as a dash", () => {
    expect(formatWhen(0)).toBe("—");
  });

  it("describes due and overdue charges distinctly", () => {
    expect(formatWhen(at(0))).toMatch(/due now|just now/);
    expect(formatWhen(at(-5 * 60_000))).toBe("5m ago");
    expect(formatWhen(at(5 * 60_000))).toBe("in 5m");
  });

  it("scales units upward", () => {
    expect(formatWhen(at(3 * 3_600_000))).toBe("in 3h");
    expect(formatWhen(at(3 * 86_400_000))).toBe("in 3d");
    expect(formatWhen(at(-2 * 86_400_000))).toBe("2d ago");
  });
});
