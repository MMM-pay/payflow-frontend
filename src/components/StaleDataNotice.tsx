"use client";

import { useEffect, useId, useState } from "react";
import { useI18n } from "@/i18n/provider";
import {
  DEFAULT_STALE_AFTER_MS,
  evaluateStaleData,
} from "@/lib/stale-data";

export interface StaleDataNoticeProps {
  /** When the displayed projection was last received, in ms since the epoch. */
  fetchedAt: number | null;
  /** Refetch the projection. Omit for a read-only warning. */
  onRefresh?: () => void | Promise<void>;
  /** A refresh is already in flight. */
  refreshing?: boolean;
  /** The last refresh failed. */
  error?: string | null;
  /** How old the figures may be before the notice appears. */
  staleAfterMs?: number;
  /** Backend-reported age of its projection, in seconds. */
  freshnessSeconds?: number | null;
  /** Injectable clock for tests. Defaults to the real time and ticks every 30s. */
  now?: number;
  /** Render a status while the first load is in flight. */
  showLoading?: boolean;
  /** Render a polite "up to date" message for assistive technology. */
  renderFresh?: boolean;
  className?: string;
}

/**
 * A small, theme-aware notice that prompts a refresh when the figures on the
 * page may no longer match on-chain state.
 *
 * The warning is a live region rather than a blocking dialog: the page keeps
 * showing the last known numbers, but says when they were fetched and offers
 * one action. A failed refresh is announced assertively, because the reader
 * may otherwise assume the button did nothing.
 */
export function StaleDataNotice({
  fetchedAt,
  onRefresh,
  refreshing = false,
  error = null,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  freshnessSeconds = null,
  now,
  showLoading = false,
  renderFresh = false,
  className = "",
}: StaleDataNoticeProps) {
  const { t: tr, formatWhen, translateMessage } = useI18n();
  const statusId = useId();
  const [clock, setClock] = useState(() => now ?? Date.now());

  useEffect(() => {
    if (now !== undefined) {
      setClock(now);
      return;
    }
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [now]);

  const current = now ?? clock;
  const evaluation = evaluateStaleData({
    fetchedAt,
    now: current,
    staleAfterMs,
    freshnessSeconds,
    loading: refreshing,
    error,
  });

  const lastUpdated =
    fetchedAt === null ? null : formatWhen(fetchedAt / 1000, current);

  const button =
    onRefresh === undefined ? null : (
      <button
        type="button"
        className="btn-ghost shrink-0 px-3 py-1 text-xs"
        disabled={refreshing}
        onClick={() => void onRefresh()}
      >
        {refreshing ? tr("Refreshing…") : tr("Refresh")}
      </button>
    );

  if (evaluation.state === "error") {
    return (
      <div
        role="alert"
        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger ${className}`}
      >
        <span>
          {lastUpdated
            ? tr("Could not refresh. Showing figures last updated {0}.", {
                "0": lastUpdated,
              })
            : tr("Could not load these figures. Try again.")}
          {error && <span className="sr-only"> {translateMessage(error)}</span>}
        </span>
        {button}
      </div>
    );
  }

  if (evaluation.state === "loading" && showLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={`inline-flex items-center gap-2 rounded-lg border border-edge bg-fg/5 px-3 py-2 text-xs text-muted ${className}`}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-muted/40 motion-safe:animate-pulse"
          aria-hidden="true"
        />
        <span>{tr("Loading figures…")}</span>
      </div>
    );
  }

  if (evaluation.state === "empty") {
    if (!showLoading) return null;
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge bg-fg/5 px-3 py-2 text-sm text-muted ${className}`}
      >
        <span>{tr("These figures have not loaded yet.")}</span>
        {button}
      </div>
    );
  }

  if (evaluation.state === "fresh") {
    if (!renderFresh) return null;
    return (
      <div
        id={statusId}
        role="status"
        aria-live="polite"
        className={`sr-only ${className}`}
      >
        {tr("These figures are up to date.")}
      </div>
    );
  }

  return (
    <div
      id={statusId}
      role="status"
      aria-live="polite"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn ${className}`}
    >
      <span>
        {lastUpdated
          ? tr("These figures were last updated {0}. Refresh to see the latest activity.", {
              "0": lastUpdated,
            })
          : tr("These figures may be out of date. Refresh to see the latest activity.")}
      </span>
      {button}
    </div>
  );
}
