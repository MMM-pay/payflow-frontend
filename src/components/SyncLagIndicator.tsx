"use client";

import { useI18n } from "@/i18n/provider";
import { useBackendSyncLag, type SyncLagEvaluation } from "@/lib/sync-lag";

export interface SyncLagIndicatorProps {
  /**
   * Explicit evaluation state override.
   * Useful for testing, Storybook, or when parent already holds health data.
   */
  state?: Partial<SyncLagEvaluation> & { loading?: boolean };
  /**
   * Whether to render a subtle indicator during loading.
   * Defaults to false (fail-soft and unobtrusive).
   */
  showLoading?: boolean;
  /**
   * Whether to render an indicator when health check errors.
   * Defaults to false (fail-soft).
   */
  showError?: boolean;
  /**
   * Whether to render an element in the empty/synced state.
   * Defaults to false (returns null).
   */
  renderEmpty?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

/**
 * Subtle indicator shown when the backend indexer is catching up with the network.
 * Sets user expectations that displayed numbers, mandate lists, or charges may briefly lag.
 *
 * Theme-aware via Tailwind tokens (--warn, --danger, --edge, --muted).
 * Accessible via role="status" and aria-live="polite".
 */
export function SyncLagIndicator({
  state: stateProp,
  showLoading = false,
  showError = false,
  renderEmpty = false,
  className = "",
}: SyncLagIndicatorProps) {
  const { t: tr, formatNumber } = useI18n();
  const hookState = useBackendSyncLag({ enabled: stateProp === undefined });

  const isCatchingUp = stateProp?.isCatchingUp ?? hookState.isCatchingUp;
  const lag = stateProp?.lag !== undefined ? stateProp.lag : hookState.lag;
  const paused = stateProp?.paused ?? hookState.paused;
  const loading = stateProp?.loading ?? hookState.loading;
  const error = stateProp?.error !== undefined ? stateProp.error : hookState.error;
  const syncState = stateProp?.state ?? hookState.state;

  // Loading state
  if (loading && showLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-testid="sync-lag-loading"
        className={`inline-flex items-center gap-2 rounded-lg border border-edge bg-fg/5 px-3 py-2 text-xs text-muted ${className}`}
      >
        <span
          className="h-2 w-2 rounded-full bg-muted/40 motion-safe:animate-pulse shrink-0"
          aria-hidden="true"
        />
        <span>{tr("Checking backend sync…")}</span>
      </div>
    );
  }

  // Error state
  if (syncState === "error" && showError) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="sync-lag-error"
        className={`inline-flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger ${className}`}
      >
        <span className="font-semibold">{tr("Backend sync status unavailable")}</span>
        {error && <span className="opacity-90">({error})</span>}
      </div>
    );
  }

  // Catching up state
  if (isCatchingUp) {
    let message: string;
    if (paused) {
      message = tr("Indexing paused by an operator — numbers may lag on-chain activity.");
    } else if (typeof lag === "number" && lag > 0) {
      message = tr(
        "Backend is catching up ({0} ledgers behind) — numbers may lag on-chain activity.",
        { "0": formatNumber(lag) },
      );
    } else {
      message = tr("Backend is catching up — numbers may lag on-chain activity.");
    }

    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="sync-lag-indicator"
        className={`flex flex-wrap items-center gap-2.5 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs font-medium text-warn transition-colors ${className}`}
      >
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-warn opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-warn" />
        </span>
        <span>{message}</span>
      </div>
    );
  }

  // Empty state (synced or skipped)
  if (renderEmpty) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="sync-lag-empty"
        className="sr-only"
      >
        {tr("Backend is in sync with the network.")}
      </div>
    );
  }

  return null;
}
