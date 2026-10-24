import { describe, expect, it } from "vitest";
import type { ApiHealth, ApiKeeperHistory } from "@/lib/api";
import {
  indexerCheckFrom,
  keeperCheckFrom,
  overallState,
  rpcCheckDown,
  rpcCheckFrom,
  stateLabel,
} from "@/lib/status";

/**
 * The status page exists to answer "which piece is broken?", so each mapping
 * here is a pure function with its own failure mode pinned: a healthy body, a
 * degraded body, a missing body, and the contract-only "no backend at all"
 * case must each produce a distinct, honest state.
 */

function health(overrides: Partial<ApiHealth> = {}): ApiHealth {
  return {
    status: "ok",
    network: "testnet",
    indexer: {
      cursor: 1000,
      latestLedger: 1010,
      lag: 10,
      paused: false,
      freshnessSeconds: 42,
      lastRunAt: "2025-06-15T15:06:40.000Z",
      lastError: null,
    },
    ...overrides,
  };
}

describe("rpcCheckFrom", () => {
  it("is ok with the ledger the node reports", () => {
    expect(rpcCheckFrom({ latestLedger: 123456 })).toEqual({
      state: "ok",
      latestLedger: 123456,
      error: null,
    });
  });

  it("is down when the body carries no usable ledger number", () => {
    // A 200 without a ledger is a broken answer, not a healthy one.
    expect(rpcCheckFrom({}).state).toBe("down");
    expect(rpcCheckFrom({ latestLedger: Number.NaN }).state).toBe("down");
    expect(rpcCheckFrom({ latestLedger: "123" as unknown as number }).state).toBe("down");
  });
});

describe("rpcCheckDown", () => {
  it("keeps the error message so the page can show why", () => {
    const check = rpcCheckDown(new Error("connect ECONNREFUSED"));
    expect(check.state).toBe("down");
    expect(check.error).toBe("connect ECONNREFUSED");
    expect(check.latestLedger).toBeNull();
  });

  it("falls back to a generic message for a non-Error throw", () => {
    expect(rpcCheckDown("boom").error).toBe("boom");
    expect(rpcCheckDown(undefined).error).toBe("RPC did not answer.");
  });
});

describe("indexerCheckFrom", () => {
  it("is ok with lag and cursor from a healthy backend", () => {
    const check = indexerCheckFrom(health(), true);
    expect(check).toMatchObject({ state: "ok", status: "ok", lag: 10, cursor: 1000, network: "testnet" });
  });

  it.each(["starting", "catching_up"])("is degraded while %s", (status) => {
    expect(indexerCheckFrom(health({ status }), true).state).toBe("degraded");
  });

  it("is down on an unrecognised status", () => {
    expect(indexerCheckFrom(health({ status: "meltdown" }), true).state).toBe("down");
  });

  it("is down when the configured backend did not answer", () => {
    const check = indexerCheckFrom(null, true);
    expect(check.state).toBe("down");
    expect(check.error).toContain("/health");
  });

  it("is skipped — not down — in contract-only mode", () => {
    // The public demo has no backend; that is a deployment choice, not an
    // outage, and the page must not cry wolf.
    expect(indexerCheckFrom(null, false).state).toBe("skipped");
  });

  it("tolerates a body with no indexer block", () => {
    const check = indexerCheckFrom(health({ indexer: null }), true);
    expect(check.state).toBe("ok");
    expect(check.lag).toBeNull();
    expect(check.cursor).toBeNull();
  });

  it("reports an operator pause", () => {
    const paused = health();
    paused.indexer!.paused = true;
    expect(indexerCheckFrom(paused, true).paused).toBe(true);
  });
});

describe("keeperCheckFrom", () => {
  const pass = {
    time: 1_750_000_000,
    attempted: 3,
    settled: 3,
    failures: [] as { mandateId: number; error: string }[],
    backoff: [],
  };

  it("reads the newest pass (history is served newest-first)", () => {
    const body: ApiKeeperHistory = { passes: [{ ...pass, settled: 1 }, { ...pass, settled: 3 }] };
    expect(keeperCheckFrom(body)).toMatchObject({
      state: "ok",
      lastRunAt: pass.time,
      attempted: 3,
      settled: 1,
      failureCount: 0,
    });
  });

  it("is degraded when the newest pass had failures", () => {
    const body: ApiKeeperHistory = {
      passes: [{ ...pass, failures: [{ mandateId: 7, error: "not enough balance" }] }],
    };
    const check = keeperCheckFrom(body);
    expect(check.state).toBe("degraded");
    expect(check.failureCount).toBe(1);
  });

  it("is degraded when the keeper has never run", () => {
    const check = keeperCheckFrom({ passes: [] });
    expect(check.state).toBe("degraded");
    expect(check.lastRunAt).toBeNull();
    expect(check.error).toContain("has not recorded");
  });

  it("is skipped when the backend does not serve keeper history", () => {
    // Null means "keeper off or no backend" — never invent an outage.
    expect(keeperCheckFrom(null).state).toBe("skipped");
  });
});

describe("overallState", () => {
  it("lets the worst state win", () => {
    expect(overallState([{ state: "ok" }, { state: "degraded" }, { state: "down" }])).toBe("down");
    expect(overallState([{ state: "ok" }, { state: "degraded" }, { state: "skipped" }])).toBe(
      "degraded",
    );
    expect(overallState([{ state: "ok" }, { state: "ok" }])).toBe("ok");
  });

  it("does not count skipped checks against the deployment", () => {
    // Contract-only: RPC ok + two skipped is overall ok, not an outage.
    expect(overallState([{ state: "ok" }, { state: "skipped" }, { state: "skipped" }])).toBe("ok");
  });

  it("is skipped when nothing applies at all", () => {
    expect(overallState([{ state: "skipped" }, { state: "skipped" }])).toBe("skipped");
  });
});

describe("stateLabel", () => {
  it("spells each state out for the badge", () => {
    expect(stateLabel("ok")).toBe("Operational");
    expect(stateLabel("degraded")).toBe("Degraded");
    expect(stateLabel("down")).toBe("Down");
    expect(stateLabel("skipped")).toBe("Not configured");
  });
});
