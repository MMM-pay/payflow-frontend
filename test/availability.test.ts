import { describe, expect, it } from "vitest";
import { planAvailability } from "@/lib/availability";

describe("plan availability", () => {
  it("hides limits for legacy and unlimited plans", () => {
    for (const plan of [{}, { available_until: 0, max_subscribers: 0, subscriber_count: 99 }]) {
      expect(planAvailability(plan, 100)).toEqual({ until: null, seats: null, reason: null, countUnavailable: false });
    }
  });
  it("closes exactly at the cutoff", () => {
    expect(planAvailability({ available_until: 100n }, 99).reason).toBeNull();
    expect(planAvailability({ available_until: 100n }, 100).reason).toMatch(/closed/);
    expect(planAvailability({ available_until: 100n }, 101).reason).toMatch(/closed/);
  });
  it.each([0, 1, 9, 10, 11])("subtracts %i open mandates and clamps at zero", (count) => {
    const state = planAvailability({ max_subscribers: 10, subscriber_count: count });
    expect(state.seats).toBe(Math.max(0, 10 - count));
    expect(Boolean(state.reason)).toBe(count >= 10);
  });
  it("does not treat absent counts as zero", () => {
    expect(planAvailability({ max_subscribers: 10 })).toMatchObject({ seats: null, countUnavailable: true });
  });
  it.each([null, "2", NaN, Infinity, -1, 1.5, true, Number.MAX_SAFE_INTEGER + 1])("ignores malformed values %s", (value) => {
    expect(planAvailability({ available_until: value, max_subscribers: value, subscriber_count: value }))
      .toEqual({ until: null, seats: null, reason: null, countUnavailable: false });
  });
});
