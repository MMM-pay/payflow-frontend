import { api, type ApiHealth, type ApiKeeperHistory } from "./api";
// The SDK-backed contract module loads on demand, so the Stellar SDK
// stays out of this route's first-load bundle.
import { server } from "./lazy-payflow";

/**
 * The status page's three checks — Soroban RPC, the indexer API, and the
 * keeper — are deliberately independent: one being down must not hide the
 * state of the other two, because "which piece is broken?" is the whole
 * question the page exists to answer. Every mapping here is a pure function
 * so that independence (and each failure mode) is testable without a
 * browser or a network.
 */

/**
 * How a single check is doing:
 * - `ok`       — answering as expected.
 * - `degraded` — answering, but behind or with nothing to report.
 * - `down`     — not answering.
 * - `skipped`  — this deployment does not run the thing (contract-only mode).
 */
export type CheckState = "ok" | "degraded" | "down" | "skipped";

export interface RpcCheck {
  state: CheckState;
  /** Latest ledger the RPC node reports, or null when it did not answer. */
  latestLedger: number | null;
  error: string | null;
}

export interface IndexerCheck {
  state: CheckState;
  /** Raw backend status: "starting" | "ok" | "catching_up". */
  status: string | null;
  /** Ledgers the projection trails the network by. */
  lag: number | null;
  cursor: number | null;
  network: string | null;
  paused: boolean | null;
  error: string | null;
}

export interface KeeperCheck {
  state: CheckState;
  /** When the most recent pass finished, Unix seconds. */
  lastRunAt: number | null;
  attempted: number | null;
  settled: number | null;
  failureCount: number | null;
  error: string | null;
}

/** A throwable's message, or null when it carries nothing useful to show. */
function usefulMessage(error: unknown): string | null {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.trim();
  if (!message || message === "undefined" || message === "[object Object]" || message === "null") {
    return null;
  }
  return message;
}

/** Map a successful RPC `getHealth` response onto a check. */
export function rpcCheckFrom(health: { latestLedger?: unknown }): RpcCheck {
  const latestLedger =
    typeof health.latestLedger === "number" && Number.isFinite(health.latestLedger)
      ? health.latestLedger
      : null;
  if (latestLedger === null) {
    return { state: "down", latestLedger: null, error: "RPC answered without a ledger number." };
  }
  return { state: "ok", latestLedger, error: null };
}

/** Map an RPC failure onto a check. The page still renders the other cards. */
export function rpcCheckDown(error: unknown): RpcCheck {
  return {
    state: "down",
    latestLedger: null,
    error: usefulMessage(error) ?? "RPC did not answer.",
  };
}

/**
 * Map the backend's `/health` body onto a check.
 *
 * `configured` is false in contract-only mode (no `NEXT_PUBLIC_API_URL`):
 * there is no backend to wait for, so the check is skipped rather than
 * reported down — the app is designed to run without one.
 */
export function indexerCheckFrom(body: ApiHealth | null, configured: boolean): IndexerCheck {
  if (!configured) {
    return {
      state: "skipped",
      status: null,
      lag: null,
      cursor: null,
      network: null,
      paused: null,
      error: null,
    };
  }
  if (!body) {
    return {
      state: "down",
      status: null,
      lag: null,
      cursor: null,
      network: null,
      paused: null,
      error: "The backend did not answer /health.",
    };
  }
  const indexer = body.indexer ?? null;
  const state: CheckState =
    body.status === "ok"
      ? "ok"
      : body.status === "starting" || body.status === "catching_up"
        ? "degraded"
        : "down";
  return {
    state,
    status: body.status ?? null,
    lag: indexer?.lag ?? null,
    cursor: indexer?.cursor ?? null,
    network: body.network ?? null,
    paused: indexer?.paused ?? null,
    error: null,
  };
}

/**
 * Map `GET /api/keeper` onto a check.
 *
 * The endpoint answers only when the backend runs with the keeper enabled, so
 * null means either "backend down" or "keeper off" — the page says both
 * possibilities instead of inventing one. An empty pass list is degraded:
 * the keeper is on but has not settled anything yet.
 */
export function keeperCheckFrom(body: ApiKeeperHistory | null): KeeperCheck {
  if (!body) {
    return {
      state: "skipped",
      lastRunAt: null,
      attempted: null,
      settled: null,
      failureCount: null,
      error: null,
    };
  }
  const pass = body.passes?.[0] ?? null; // newest first
  if (!pass) {
    return {
      state: "degraded",
      lastRunAt: null,
      attempted: null,
      settled: null,
      failureCount: null,
      error: "The keeper has not recorded a settlement pass yet.",
    };
  }
  const failures = Array.isArray(pass.failures) ? pass.failures.length : 0;
  return {
    state: failures > 0 ? "degraded" : "ok",
    lastRunAt: typeof pass.time === "number" ? pass.time : null,
    attempted: typeof pass.attempted === "number" ? pass.attempted : null,
    settled: typeof pass.settled === "number" ? pass.settled : null,
    failureCount: failures,
    error: null,
  };
}

/** Run the RPC check. Never throws: a failure becomes a `down` check. */
export async function checkRpc(): Promise<RpcCheck> {
  try {
    return rpcCheckFrom(await server.getHealth());
  } catch (err) {
    return rpcCheckDown(err);
  }
}

/** Run the indexer API check. Never throws. */
export async function checkIndexer(): Promise<IndexerCheck> {
  try {
    return indexerCheckFrom(await api.health(), api.isConfigured());
  } catch (err) {
    // The fetch layer is already fail-soft; this is belt and braces so one
    // unexpected throw can never take the page down with it.
    return {
      state: "down",
      status: null,
      lag: null,
      cursor: null,
      network: null,
      paused: null,
      error: usefulMessage(err) ?? "The backend did not answer /health.",
    };
  }
}

/** Run the keeper check. Never throws. */
export async function checkKeeper(): Promise<KeeperCheck> {
  try {
    return keeperCheckFrom(await api.keeper());
  } catch (err) {
    return {
      state: "skipped",
      lastRunAt: null,
      attempted: null,
      settled: null,
      failureCount: null,
      error: usefulMessage(err),
    };
  }
}

/** Short human label for a state, used as the badge text. */
export function stateLabel(state: CheckState): string {
  switch (state) {
    case "ok":
      return "Operational";
    case "degraded":
      return "Degraded";
    case "down":
      return "Down";
    case "skipped":
      return "Not configured";
  }
}

/**
 * One summary for the page header: the worst state wins, `skipped` never
 * counts against it (contract-only mode is a supported deployment, not an
 * outage).
 */
export function overallState(checks: { state: CheckState }[]): CheckState {
  if (checks.some((c) => c.state === "down")) return "down";
  if (checks.some((c) => c.state === "degraded")) return "degraded";
  if (checks.every((c) => c.state === "skipped")) return "skipped";
  return "ok";
}
