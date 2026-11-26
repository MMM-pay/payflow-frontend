import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALE_AFTER_MS,
  evaluateStaleData,
} from "@/lib/stale-data";

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);

describe("evaluateStaleData", () => {
  it("treats a recent local fetch as fresh", () => {
    const result = evaluateStaleData({
      fetchedAt: NOW - 1_000,
      now: NOW,
    });
    expect(result.state).toBe("fresh");
    expect(result.isStale).toBe(false);
    expect(result.ageMs).toBe(1_000);
    expect(result.staleAfterMs).toBe(DEFAULT_STALE_AFTER_MS);
  });

  it("marks data older than the threshold as stale", () => {
    const result = evaluateStaleData({
      fetchedAt: NOW - 10 * 60_000,
      now: NOW,
    });
    expect(result.state).toBe("stale");
    expect(result.isStale).toBe(true);
    expect(result.effectiveAgeMs).toBe(10 * 60_000);
  });

  it("honours a custom threshold", () => {
    const result = evaluateStaleData({
      fetchedAt: NOW - 2_000,
      now: NOW,
      staleAfterMs: 1_000,
    });
    expect(result.state).toBe("stale");
  });

  it("lets a lagging backend projection win over a recent local fetch", () => {
    const result = evaluateStaleData({
      fetchedAt: NOW - 1_000,
      now: NOW,
      freshnessSeconds: 15 * 60,
    });
    expect(result.projectionAgeMs).toBe(15 * 60_000);
    expect(result.effectiveAgeMs).toBe(15 * 60_000);
    expect(result.state).toBe("stale");
  });

  it("distinguishes a first load from an empty response", () => {
    expect(
      evaluateStaleData({ fetchedAt: null, now: NOW, loading: true }).state,
    ).toBe("loading");
    expect(evaluateStaleData({ fetchedAt: null, now: NOW }).state).toBe("empty");
  });

  it("reports an error even when the last data is still recent", () => {
    const result = evaluateStaleData({
      fetchedAt: NOW - 500,
      now: NOW,
      error: "Request failed",
    });
    expect(result.state).toBe("error");
    expect(result.isStale).toBe(true);
    expect(result.ageMs).toBe(500);
  });

  it("ignores an invalid backend freshness value", () => {
    const result = evaluateStaleData({
      fetchedAt: NOW - 1_000,
      now: NOW,
      freshnessSeconds: Number.NaN,
    });
    expect(result.projectionAgeMs).toBeNull();
    expect(result.state).toBe("fresh");
  });
});
