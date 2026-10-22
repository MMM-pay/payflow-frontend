import { describe, expect, it } from "vitest";
import {
  CUSTOM_PERIOD,
  DEFAULT_PERIOD,
  MIN_PERIOD_MESSAGE,
  MIN_PERIOD_SECONDS,
  PERIOD_PRESETS,
  PERIOD_UNITS,
  TOO_LONG_MESSAGE,
  checkCustomPeriod,
  checkPeriodSeconds,
  unitFor,
  unitLabel,
} from "@/lib/period";

/**
 * The publish form used to offer five fixed periods, so a merchant billing
 * fortnightly or quarterly could not use Payflow at all. These tests pin the
 * conversion behind the Custom option and, above all, the acceptance
 * criterion: a period the contract's `create_plan` would reject on its
 * 60-second floor must be rejected in the form, with the contract's own
 * wording, before a wallet ever opens.
 */

const DAY = 86_400;
const WEEK = 604_800;
const MONTH = 2_592_000;

describe("period presets", () => {
  it("keeps the original five options, in order and at their old values", () => {
    expect(PERIOD_PRESETS.map((p) => p.label)).toEqual([
      "Every minute (demo)",
      "Daily",
      "Weekly",
      "Monthly",
      "Yearly",
    ]);
    expect(PERIOD_PRESETS.map((p) => p.value)).toEqual([60, DAY, WEEK, MONTH, 31_536_000]);
  });

  it("opens on the same monthly default the form always had", () => {
    expect(DEFAULT_PERIOD).toBe(MONTH);
    expect(PERIOD_PRESETS.some((p) => p.value === DEFAULT_PERIOD && p.label === "Monthly")).toBe(
      true,
    );
  });

  it("offers days, weeks and months at the seconds the presets already use", () => {
    expect(PERIOD_UNITS.map((u) => [u.name, u.seconds])).toEqual([
      ["day", DAY],
      ["week", WEEK],
      ["month", MONTH],
    ]);
    // A month is 30 days here on purpose, so a custom quarterly plan and a
    // preset monthly plan sit on one scale.
    expect(MONTH).toBe(30 * DAY);
    expect(WEEK).toBe(7 * DAY);
  });
});

describe("unitFor", () => {
  it("resolves each unit the picker offers", () => {
    expect(unitFor("day").seconds).toBe(DAY);
    expect(unitFor("week").seconds).toBe(WEEK);
    expect(unitFor("month").seconds).toBe(MONTH);
  });

  it("falls back to days rather than to nothing", () => {
    // An unknown select value must not become a period of zero seconds.
    expect(unitFor("fortnight").seconds).toBe(DAY);
    expect(unitFor(null).seconds).toBe(DAY);
    expect(unitFor(undefined).seconds).toBe(DAY);
  });

  it("labels units for the option text", () => {
    expect(PERIOD_UNITS.map(unitLabel)).toEqual(["Days", "Weeks", "Months"]);
  });
});

describe("checkCustomPeriod", () => {
  it("converts the lengths the issue names: fortnightly and quarterly", () => {
    expect(checkCustomPeriod("14", "day")).toEqual({ ok: true, seconds: 14 * DAY });
    expect(checkCustomPeriod("2", "week")).toEqual({ ok: true, seconds: 2 * WEEK });
    expect(checkCustomPeriod("3", "month")).toEqual({ ok: true, seconds: 3 * MONTH });
    // 2 weeks and 14 days are the same mandate length, and must publish the
    // same u64 however the merchant chooses to express it.
    expect(2 * WEEK).toBe(14 * DAY);
    expect(3 * MONTH).toBe(90 * DAY);
  });

  it("returns whole seconds, never a fraction", () => {
    const result = checkCustomPeriod("1", "month");
    expect(result.ok && Number.isInteger(result.seconds)).toBe(true);
  });

  it("rejects a count below the contract's 60-second floor with its wording", () => {
    // Zero is the only count of days/weeks/months that reaches the floor, so
    // it carries the acceptance criterion: rejected in the form, with the
    // message the contract itself would return.
    expect(checkCustomPeriod("0", "day")).toEqual({ ok: false, message: MIN_PERIOD_MESSAGE });
    expect(checkCustomPeriod("0", "week")).toEqual({ ok: false, message: MIN_PERIOD_MESSAGE });
    expect(checkCustomPeriod("0", "month")).toEqual({ ok: false, message: MIN_PERIOD_MESSAGE });
  });

  it("treats an empty or unreadable count as not-yet-valid rather than as zero", () => {
    expect(checkCustomPeriod("", "day")).toEqual({ ok: false, message: "Enter a whole number of days." });
    expect(checkCustomPeriod("  ", "week")).toEqual({
      ok: false,
      message: "Enter a whole number of weeks.",
    });
    expect(checkCustomPeriod("1.5", "day")).toEqual({
      ok: false,
      message: "Enter a whole number of days.",
    });
    expect(checkCustomPeriod("1e4", "day")).toEqual({
      ok: false,
      message: "Enter a whole number of days.",
    });
    expect(checkCustomPeriod("renewal", "day")).toEqual({
      ok: false,
      message: "Enter a whole number of days.",
    });
  });

  it("explains a negative count rather than silently dropping the sign", () => {
    expect(checkCustomPeriod("-3", "day")).toEqual({
      ok: false,
      message: "Enter a positive number of days.",
    });
  });

  it("tolerates the whitespace a paste can leave behind", () => {
    expect(checkCustomPeriod(" 14 ", "day")).toEqual({ ok: true, seconds: 14 * DAY });
  });

  it("refuses a count whose product would lose precision in a Number", () => {
    // `create_plan` takes a u64, but this app passes a `number`: beyond 2^53
    // the seconds figure would be rounded, publishing a length nobody chose.
    expect(checkCustomPeriod("99999999999999999999", "day")).toEqual({
      ok: false,
      message: TOO_LONG_MESSAGE,
    });
    expect(checkCustomPeriod("100000000000000", "day")).toEqual({
      ok: false,
      message: TOO_LONG_MESSAGE,
    });
  });
});

describe("checkPeriodSeconds", () => {
  it("accepts exactly the contract's floor and anything above it", () => {
    expect(checkPeriodSeconds(MIN_PERIOD_SECONDS)).toEqual({ ok: true, seconds: 60 });
    expect(checkPeriodSeconds(61).ok).toBe(true);
    expect(checkPeriodSeconds(DAY).ok).toBe(true);
  });

  it("rejects anything below the floor", () => {
    expect(checkPeriodSeconds(59)).toEqual({ ok: false, message: MIN_PERIOD_MESSAGE });
    expect(checkPeriodSeconds(0)).toEqual({ ok: false, message: MIN_PERIOD_MESSAGE });
    expect(checkPeriodSeconds(-60)).toEqual({ ok: false, message: MIN_PERIOD_MESSAGE });
  });

  it("rejects values a u64 cannot carry exactly", () => {
    // Not-a-number and infinity are caught by the finite check first: neither
    // is a period the contract could store, whatever message names them.
    expect(checkPeriodSeconds(Number.NaN)).toEqual({ ok: false, message: MIN_PERIOD_MESSAGE });
    expect(checkPeriodSeconds(Number.POSITIVE_INFINITY)).toEqual({
      ok: false,
      message: MIN_PERIOD_MESSAGE,
    });
    expect(checkPeriodSeconds(2 ** 53 + 2)).toEqual({ ok: false, message: TOO_LONG_MESSAGE });
  });

  it("leaves the picker's sentinel distinct from every preset", () => {
    expect(CUSTOM_PERIOD).toBe("custom");
    expect(PERIOD_PRESETS.some((p) => String(p.value) === CUSTOM_PERIOD)).toBe(false);
  });
});
