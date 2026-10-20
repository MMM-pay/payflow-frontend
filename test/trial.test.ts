import { describe, expect, it } from "vitest";
import {
  describeTrialEnd,
  formatTrialLength,
  trialAdjective,
  hasTrial,
  matchingTrialOption,
  supportsTrials,
  trialBadge,
  trialEndsAt,
  trialSeconds,
  TRIAL_OPTIONS,
} from "@/lib/trial";
import { formatDate } from "@/lib/format";
import type { ApiMandate } from "@/lib/api";

/**
 * Free trials are gated on payflow-contract#9, which has not shipped, so most of
 * what matters here is the behaviour when the field is *absent*: an unsupported
 * deployment must show nothing rather than claim a plan has no trial, and must
 * never turn `next_charge` into a trial that was never offered.
 */

const DAY = 86_400;
const NOW = 1_760_000_000; // fixed so `describeTrialEnd` is deterministic

function mandate(over: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 1,
    subscriber: "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE",
    merchant: "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU",
    plan_id: 1,
    amount: "10000000",
    period: 30 * DAY,
    next_charge: NOW + 14 * DAY,
    last_charge: 0,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
    trial: 14 * DAY,
    ...over,
  };
}

describe("trialSeconds", () => {
  it("reads a length from either source", () => {
    // scValToNative gives a bigint for a u64; the indexer sends a JSON number.
    expect(trialSeconds({ trial: 14 * DAY })).toBe(14 * DAY);
    expect(trialSeconds({ trial: BigInt(14 * DAY) })).toBe(14 * DAY);
  });

  it("treats a missing field as no trial", () => {
    expect(trialSeconds({})).toBe(0);
    expect(trialSeconds(undefined)).toBe(0);
    expect(trialSeconds(null)).toBe(0);
    expect(trialSeconds({ trial: 0 })).toBe(0);
  });

  it("never turns a malformed value into a badge", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, "abc", {}, []]) {
      expect(trialSeconds({ trial: bad }), `trial ${String(bad)}`).toBe(0);
    }
  });

  it("truncates rather than rounding a fractional length", () => {
    expect(trialSeconds({ trial: 90.9 })).toBe(90);
  });
});

describe("supportsTrials", () => {
  it("is false when the field is absent, which is what an old contract returns", () => {
    // This distinction is the whole gate: `undefined` means "this contract
    // cannot say", 0 means "this plan has no trial".
    expect(supportsTrials({})).toBe(false);
    expect(supportsTrials(undefined)).toBe(false);
  });

  it("is true as soon as the source carries the field at all", () => {
    expect(supportsTrials({ trial: 0 })).toBe(true);
    expect(supportsTrials({ trial: 14 * DAY })).toBe(true);
    expect(supportsTrials({ trial: BigInt(0) })).toBe(true);
  });
});

describe("trialBadge", () => {
  it("says nothing for a plan without a trial", () => {
    // The acceptance criterion. Null rather than "" so no empty pill renders.
    expect(trialBadge({ trial: 0 })).toBeNull();
    expect(trialBadge({})).toBeNull();
    expect(trialBadge(undefined)).toBeNull();
  });

  it("names the length for a plan that has one", () => {
    expect(trialBadge({ trial: DAY })).toBe("1-day free trial");
    expect(trialBadge({ trial: 14 * DAY })).toBe("14-day free trial");
    expect(trialBadge({ trial: 30 * DAY })).toBe("30-day free trial");
    // Days, not weeks: the badge has to match the preset a merchant picked.
    expect(trialBadge({ trial: 7 * DAY })).toBe("7-day free trial");
    expect(trialBadge({ trial: 2 * 3_600 })).toBe("2-hour free trial");
    expect(trialBadge({ trial: 90 * 60 })).toBe("90-minute free trial");
  });

  it("agrees with hasTrial", () => {
    for (const trial of [0, DAY, 14 * DAY, undefined]) {
      const plan = trial === undefined ? {} : { trial };
      expect(hasTrial(plan)).toBe(trialBadge(plan) !== null);
    }
  });
});

describe("formatTrialLength", () => {
  it("picks the largest unit that divides evenly, in days", () => {
    // Days, not weeks: a merchant picks "14 days" from the preset list, and a
    // card reading "2-week free trial" would contradict the control they used.
    expect(formatTrialLength(28 * DAY)).toBe("28 days");
    expect(formatTrialLength(14 * DAY)).toBe("14 days");
    expect(formatTrialLength(90 * 60)).toBe("90 minutes");
    expect(formatTrialLength(45 * 60)).toBe("45 minutes");
  });

  it("falls back to seconds rather than rounding to a unit nobody chose", () => {
    // A 90-minute trial is not 2 days, and showing it as 0.0012 days helps
    // nobody.
    expect(formatTrialLength(90 * 60 + 30)).toBe("5430 seconds");
    expect(formatTrialLength(1)).toBe("1 second");
  });

  it("keeps the unit singular in the adjectival form a badge uses", () => {
    // "14-day free trial", never "14-days free trial".
    expect(trialAdjective(14 * DAY)).toBe("14-day");
    expect(trialAdjective(DAY)).toBe("1-day");
    expect(trialAdjective(1)).toBe("1-second");
  });
});

describe("trialEndsAt", () => {
  it("returns the first charge date while the trial is still running", () => {
    expect(trialEndsAt(mandate())).toBe(NOW + 14 * DAY);
  });

  it("is null once the first charge has settled", () => {
    // After it, next_charge has moved on to the next period and there is no
    // trial left to report.
    expect(trialEndsAt(mandate({ charges_made: 1 }))).toBeNull();
    expect(trialEndsAt(mandate({ charges_made: 5 }))).toBeNull();
  });

  it("is null for a mandate whose source cannot report a trial", () => {
    // The dangerous case: inferring a trial from next_charge alone would put
    // one on every mandate ever opened, since every mandate's first period
    // starts in the future.
    const noTrialField = mandate();
    delete noTrialField.trial;
    expect(trialEndsAt(noTrialField)).toBeNull();
    expect(trialEndsAt(mandate({ trial: 0 }))).toBeNull();
  });

  it("is null rather than the epoch for a missing next charge", () => {
    expect(trialEndsAt(mandate({ next_charge: 0 }))).toBeNull();
  });

  it("is null for a cancelled or completed mandate", () => {
    // "Free trial ends in 3d, cancel before then" on a mandate that is already
    // cancelled is nonsense.
    expect(trialEndsAt(mandate({ status: "Cancelled" }))).toBeNull();
    expect(trialEndsAt(mandate({ status: "Completed" }))).toBeNull();
    expect(trialEndsAt(mandate({ status: "Paused" }))).toEqual(NOW + 14 * DAY);
  });
});

describe("describeTrialEnd", () => {
  it("gives the absolute date and how far away it is", () => {
    const text = describeTrialEnd(mandate(), NOW);
    expect(text).toContain(formatDate(NOW + 14 * DAY));
    expect(text).toContain("Free trial ends");
    // Issue #45 spells the relative part out; the exact date is above.
    expect(text).toContain("in 14 days");
  });

  it("switches to the past once the trial is over but no charge has settled", () => {
    const text = describeTrialEnd(mandate({ next_charge: NOW - DAY }), NOW);
    expect(text).toContain("Free trial ended");
    expect(text).toContain(formatDate(NOW - DAY));
  });

  it("says nothing when there is no trial", () => {
    const plan = mandate({ trial: 0 });
    expect(describeTrialEnd(plan, NOW)).toBeNull();
  });
});

describe("TRIAL_OPTIONS", () => {
  it("offers only lengths a badge can name in whole units", () => {
    for (const option of TRIAL_OPTIONS) {
      expect(formatTrialLength(option.seconds)).not.toContain("second");
    }
  });

  it("matches a length back to its preset", () => {
    expect(matchingTrialOption(14 * DAY)?.label).toBe("14 days");
    expect(matchingTrialOption(90 * 60)).toBeNull();
  });

  it("never offers a trial longer than it is plausible to mean", () => {
    for (const option of TRIAL_OPTIONS) {
      expect(option.seconds).toBeGreaterThan(0);
      expect(option.seconds).toBeLessThanOrEqual(90 * DAY);
    }
  });
});