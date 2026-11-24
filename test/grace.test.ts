import { describe, expect, it } from "vitest";
import { GRACE_URGENT_SECONDS, graceState } from "@/lib/grace";

/** Where a past-due mandate stands in its grace period (issue #392). */
describe("graceState", () => {
  const now = Date.UTC(2026, 10, 25, 12, 0) / 1000;
  const nowMs = now * 1000;

  it("has nothing to show when the contract does not report a grace period", () => {
    expect(graceState(null, nowMs)).toEqual({ kind: "none" });
    expect(graceState(0, nowMs)).toEqual({ kind: "none" });
    expect(graceState(Number.NaN, nowMs)).toEqual({ kind: "none" });
  });

  it("is open, and not yet urgent, with more than a day left", () => {
    expect(graceState(now + 3 * 86_400, nowMs)).toEqual({ kind: "open", until: now + 3 * 86_400, urgent: false });
    expect(graceState(now + GRACE_URGENT_SECONDS + 1, nowMs)).toMatchObject({ kind: "open", urgent: false });
  });

  it("turns urgent in the last day", () => {
    expect(graceState(now + GRACE_URGENT_SECONDS, nowMs)).toMatchObject({ kind: "open", urgent: true });
    expect(graceState(now + 60, nowMs)).toMatchObject({ kind: "open", urgent: true });
  });

  it("has ended at and after its end", () => {
    expect(graceState(now, nowMs)).toEqual({ kind: "ended", until: now });
    expect(graceState(now - 3600, nowMs)).toEqual({ kind: "ended", until: now - 3600 });
  });
});
