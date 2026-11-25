import { describe, expect, it } from "vitest";
import type { ApiHealth } from "@/lib/api";
import { evaluateSyncLag, syncLagMessage } from "@/lib/sync-lag";

function mockHealth(overrides: Partial<ApiHealth> = {}): ApiHealth {
  return {
    status: "ok",
    network: "testnet",
    indexer: {
      cursor: 1000,
      latestLedger: 1000,
      lag: 0,
      paused: false,
      freshnessSeconds: 5,
      lastRunAt: "2026-11-24T20:00:00.000Z",
      lastError: null,
    },
    ...overrides,
  };
}

describe("evaluateSyncLag", () => {
  it("returns skipped when backend is not configured (contract-only mode)", () => {
    const res = evaluateSyncLag(null, false);
    expect(res).toEqual({
      state: "skipped",
      isCatchingUp: false,
      lag: null,
      status: null,
      paused: false,
      error: null,
    });
  });

  it("returns error when configured backend did not answer /health", () => {
    const res = evaluateSyncLag(null, true);
    expect(res.state).toBe("error");
    expect(res.isCatchingUp).toBe(false);
    expect(res.error).toContain("/health");
  });

  it("returns synced when status is ok and lag is 0", () => {
    const res = evaluateSyncLag(mockHealth(), true);
    expect(res).toEqual({
      state: "synced",
      isCatchingUp: false,
      lag: 0,
      status: "ok",
      paused: false,
      error: null,
    });
  });

  it("identifies catching_up when status is catching_up", () => {
    const res = evaluateSyncLag(mockHealth({ status: "catching_up" }), true);
    expect(res.state).toBe("catching_up");
    expect(res.isCatchingUp).toBe(true);
  });

  it("identifies catching_up when status is starting", () => {
    const res = evaluateSyncLag(mockHealth({ status: "starting" }), true);
    expect(res.state).toBe("catching_up");
    expect(res.isCatchingUp).toBe(true);
  });

  it("identifies catching_up when lag is positive even if status is ok", () => {
    const res = evaluateSyncLag(
      mockHealth({
        status: "ok",
        indexer: {
          cursor: 1000,
          latestLedger: 1025,
          lag: 25,
          paused: false,
          freshnessSeconds: 120,
          lastRunAt: "2026-11-24T20:00:00.000Z",
          lastError: null,
        },
      }),
      true,
    );
    expect(res.state).toBe("catching_up");
    expect(res.isCatchingUp).toBe(true);
    expect(res.lag).toBe(25);
  });

  it("captures paused operator state", () => {
    const res = evaluateSyncLag(
      mockHealth({
        status: "catching_up",
        indexer: {
          cursor: 1000,
          latestLedger: 1010,
          lag: 10,
          paused: true,
          freshnessSeconds: 60,
          lastRunAt: null,
          lastError: null,
        },
      }),
      true,
    );
    expect(res.paused).toBe(true);
    expect(res.isCatchingUp).toBe(true);
  });

  it("handles body with null indexer block gracefully", () => {
    const res = evaluateSyncLag(mockHealth({ indexer: null }), true);
    expect(res.state).toBe("synced");
    expect(res.isCatchingUp).toBe(false);
    expect(res.lag).toBeNull();
  });
});

describe("syncLagMessage", () => {
  it("formats message with positive lag and formatter", () => {
    const msg = syncLagMessage({ lag: 42 }, (n) => `#${n}`);
    expect(msg).toBe("Backend is catching up (#42 ledgers behind) — numbers may lag on-chain activity.");
  });

  it("formats message with positive lag without formatter", () => {
    const msg = syncLagMessage({ lag: 15 });
    expect(msg).toBe("Backend is catching up (15 ledgers behind) — numbers may lag on-chain activity.");
  });

  it("formats message when lag is null or 0", () => {
    const msg = syncLagMessage({ lag: null });
    expect(msg).toBe("Backend is catching up — numbers may lag on-chain activity.");
  });

  it("prioritizes paused message when indexing is paused", () => {
    const msg = syncLagMessage({ lag: 50, paused: true });
    expect(msg).toBe("Indexing paused by an operator — numbers may lag on-chain activity.");
  });
});
