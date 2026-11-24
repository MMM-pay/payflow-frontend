import { startTransition, useCallback, useEffect, useState } from "react";
import { api, type ApiHealth } from "./api";

/**
 * How the backend's indexing sync is doing relative to the network:
 * - `synced`: Backend is caught up with the latest network ledger.
 * - `catching_up`: Backend is actively processing historical or recent ledgers.
 * - `loading`: Sync health probe is currently in flight.
 * - `error`: Backend /health check failed or threw.
 * - `skipped`: Build runs in contract-only mode (no API configured).
 */
export type SyncState = "synced" | "catching_up" | "loading" | "error" | "skipped";

export interface SyncLagEvaluation {
  state: SyncState;
  /** Whether the backend is trailing the network ledger. */
  isCatchingUp: boolean;
  /** Ledgers the projection trails the network by, or null if unknown. */
  lag: number | null;
  /** Raw backend status string (e.g. "ok", "catching_up", "starting"). */
  status: string | null;
  /** Whether an operator has paused indexing. */
  paused: boolean;
  /** Error message if health check failed. */
  error: string | null;
}

/**
 * Pure evaluation function that maps an ApiHealth payload and configuration state
 * onto a SyncLagEvaluation.
 */
export function evaluateSyncLag(
  health: ApiHealth | null,
  configured: boolean,
): SyncLagEvaluation {
  if (!configured) {
    return {
      state: "skipped",
      isCatchingUp: false,
      lag: null,
      status: null,
      paused: false,
      error: null,
    };
  }

  if (!health) {
    return {
      state: "error",
      isCatchingUp: false,
      lag: null,
      status: null,
      paused: false,
      error: "The backend did not answer /health.",
    };
  }

  const status = health.status ?? null;
  const indexer = health.indexer ?? null;
  const lag =
    typeof indexer?.lag === "number" && Number.isFinite(indexer.lag)
      ? indexer.lag
      : null;
  const paused = Boolean(indexer?.paused);

  // Backend is catching up if status explicitly says so, or if it is starting,
  // or if there is a positive ledger lag reported by the indexer.
  const isStatusCatchingUp = status === "catching_up" || status === "starting";
  const isLagPositive = lag !== null && lag > 0;
  const isCatchingUp = isStatusCatchingUp || isLagPositive;

  return {
    state: isCatchingUp ? "catching_up" : "synced",
    isCatchingUp,
    lag,
    status,
    paused,
    error: null,
  };
}

/**
 * Generate human-readable message for sync lag expectation setting.
 */
export function syncLagMessage(
  evaluation: { lag: number | null; paused?: boolean },
  formatNumber?: (n: number | bigint) => string,
): string {
  if (evaluation.paused) {
    return "Indexing paused by an operator — numbers may lag on-chain activity.";
  }
  if (typeof evaluation.lag === "number" && evaluation.lag > 0) {
    const formattedLag = formatNumber ? formatNumber(evaluation.lag) : String(evaluation.lag);
    return `Backend is catching up (${formattedLag} ledgers behind) — numbers may lag on-chain activity.`;
  }
  return "Backend is catching up — numbers may lag on-chain activity.";
}

export interface UseBackendSyncLagOptions {
  /** Optional polling interval in milliseconds. Omit or set 0 to disable polling. */
  pollIntervalMs?: number;
  /** Whether the check is active. Defaults to true. */
  enabled?: boolean;
}

/**
 * React hook that monitors backend sync lag.
 * Fails soft: never throws, returns skipped state in contract-only mode.
 */
export function useBackendSyncLag(options?: UseBackendSyncLagOptions) {
  const enabled = options?.enabled ?? true;
  const isConfigured = api.isConfigured();

  const [loading, setLoading] = useState(enabled && isConfigured);
  const [evaluation, setEvaluation] = useState<SyncLagEvaluation>(() =>
    evaluateSyncLag(null, isConfigured ? false : false),
  );

  const check = useCallback(async () => {
    if (!api.isConfigured() || !enabled) {
      startTransition(() => {
        setEvaluation(evaluateSyncLag(null, false));
        setLoading(false);
      });
      return;
    }
    try {
      const health = await api.health();
      startTransition(() => {
        setEvaluation(evaluateSyncLag(health, true));
      });
    } catch (err) {
      startTransition(() => {
        setEvaluation({
          state: "error",
          isCatchingUp: false,
          lag: null,
          status: null,
          paused: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } finally {
      startTransition(() => {
        setLoading(false);
      });
    }
  }, [enabled]);

  useEffect(() => {
    let mounted = true;
    if (!enabled || !isConfigured) {
      startTransition(() => {
        setLoading(false);
      });
      return;
    }

    void check();

    const interval = options?.pollIntervalMs;
    if (interval && interval > 0) {
      const timer = setInterval(() => {
        if (mounted) void check();
      }, interval);
      return () => {
        mounted = false;
        clearInterval(timer);
      };
    }
    return () => {
      mounted = false;
    };
  }, [check, enabled, isConfigured, options?.pollIntervalMs]);

  return {
    ...evaluation,
    loading,
    refetch: check,
  };
}
