"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { api } from "@/lib/api";

/** The four outcomes the banner cares about. */
export type ConnectionStatus = "ok" | "offline" | "unreachable" | "contract-only";

export interface ConnectionStatusOptions {
  /** Overrides the build's API configuration, mainly for tests. */
  configured?: boolean;
  /** Resolves true when `/health` answered. Overridable for tests. */
  probe?: () => Promise<boolean>;
  /** Reads the browser's online flag. Overridable for tests and SSR. */
  isOnline?: () => boolean;
}

const defaultProbe = async () => (await api.health()) !== null;
const defaultIsOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

/**
 * Combines the browser's online flag with a `/health` probe.
 *
 * The first check stays silent: a banner on every page load would be a false
 * alarm, and would change the contract-only screenshots. A failed probe is the
 * only thing that escalates to `unreachable`; going offline is immediate.
 */
export function useConnectionStatus(options: ConnectionStatusOptions = {}) {
  const configured = options.configured ?? api.isConfigured();
  const isOnline = options.isOnline ?? defaultIsOnline;
  const probe = options.probe ?? defaultProbe;
  const isOnlineRef = useRef(isOnline);
  const probeRef = useRef(probe);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  useEffect(() => { probeRef.current = probe; }, [probe]);

  const [online, setOnline] = useState(() => isOnline());
  const [attempt, setAttempt] = useState(0);
  // Each new problem gets its own episode so a dismissal does not silence a
  // later outage. Results are keyed to an attempt so a slow response from an
  // earlier probe cannot overwrite a retry. Status itself is derived, never stored.
  const [episode, setEpisode] = useState(0);
  const [result, setResult] = useState<{ attempt: number; reachable: boolean } | null>(null);
  const settledResult = result?.attempt === attempt ? result : null;
  const settled = settledResult !== null;

  const onBrowserConnectionChange = useCallback(() => {
    const next = isOnlineRef.current();
    setOnline(next);
    if (next && configured) {
      // Coming back online is a fresh probe, not a claim that the API is up.
      setAttempt((value) => value + 1);
    } else if (!next && configured) {
      setEpisode((value) => value + 1);
    }
  }, [configured]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("online", onBrowserConnectionChange);
    window.addEventListener("offline", onBrowserConnectionChange);
    return () => {
      window.removeEventListener("online", onBrowserConnectionChange);
      window.removeEventListener("offline", onBrowserConnectionChange);
    };
  }, [onBrowserConnectionChange]);

  useEffect(() => {
    if (!online || !configured || settled) return;
    let cancelled = false;
    void Promise.resolve()
      .then(() => probeRef.current())
      .then((reachable) => {
        if (cancelled) return;
        setResult({ attempt, reachable });
        if (!reachable) setEpisode((value) => value + 1);
      })
      .catch(() => {
        if (cancelled) return;
        setResult({ attempt, reachable: false });
        setEpisode((value) => value + 1);
      });
    return () => { cancelled = true; };
  }, [attempt, configured, online, settled]);

  const retry = useCallback(() => {
    if (!isOnlineRef.current()) {
      onBrowserConnectionChange();
      return;
    }
    setAttempt((value) => value + 1);
  }, [onBrowserConnectionChange]);

  const checking = online && configured && !settled;
  const status: ConnectionStatus = !online ? "offline"
    : !configured ? "contract-only"
    : settledResult ? (settledResult.reachable ? "ok" : "unreachable")
    : "ok";

  return { status, checking, online, configured, episode, retry };
}

export interface ConnectionBannerProps {
  /** Explicit state for tests/stories; the live hook is used when omitted. */
  status?: ConnectionStatus;
  checking?: boolean;
  /** Identifies a distinct outage, so dismissing one does not hide the next. */
  episode?: number;
  onRetry?: () => void;
  className?: string;
}

/**
 * App-wide, dismissible connection notice. Uses the same theme tokens as the
 * other status notices (`warn`/`danger`) and never renders in the healthy,
 * still-checking, or contract-only states, so the default UI is unchanged.
 */
export function ConnectionBanner({
  status: statusProp,
  checking: checkingProp,
  episode: episodeProp,
  onRetry: onRetryProp,
  className = "",
}: ConnectionBannerProps) {
  const { t: tr } = useI18n();
  const live = useConnectionStatus(statusProp === undefined ? undefined : { configured: false });
  const status = statusProp ?? live.status;
  const checking = checkingProp ?? live.checking;
  const episode = episodeProp ?? (statusProp === undefined ? live.episode : 0);
  const onRetry = onRetryProp ?? live.retry;
  // Remember the exact problem that was dismissed; a later episode or a
  // different state shows again without an effect resetting the flag.
  const [dismissed, setDismissed] = useState<{ status: ConnectionStatus; episode: number } | null>(null);
  const isDismissed = dismissed?.status === status && dismissed.episode === episode;

  if (isDismissed || status === "ok" || status === "contract-only") return null;

  const offline = status === "offline";
  return (
    <div className="mx-auto max-w-5xl px-5 pt-4 print:hidden">
      <div
        data-testid="connection-banner"
        role={offline ? "status" : "alert"}
        aria-live={offline ? "polite" : "assertive"}
        aria-busy={checking ? true : undefined}
        className={`flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
          offline ? "border-warn/40 bg-warn/10 text-warn" : "border-danger/40 bg-danger/10 text-danger"
        } ${className}`}
      >
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{offline ? tr("Connection lost") : tr("Backend is unreachable")}</p>
          <p className="mt-0.5 opacity-90">
            {offline
              ? tr("Your device is offline. Contract-backed pages stay available and your changes resume when the connection returns.")
              : tr("Live backend data may be out of date. Contract-backed plans, balances and mandates still work.")}
          </p>
          {checking && <p className="mt-1 text-xs font-medium">{tr("Checking connection…")}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={checking}
            className="btn-ghost min-h-11 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            {tr("Retry")}
          </button>
          <button
            type="button"
            onClick={() => setDismissed({ status, episode })}
            aria-label={tr("Dismiss connection notice")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-fg/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
