"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider";

const WARNING_VERSION = "unaudited-warning-v1";

export function warningDismissalKey(networkId: string): string {
  return `payflow.warning.dismissed.${networkId}.${WARNING_VERSION}`;
}

export function PersistentWarningBanner({ networkId }: { networkId: string }) {
  const { t: tr } = useI18n();
  const key = warningDismissalKey(networkId);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissedKey(window.localStorage.getItem(key) === "true" ? key : null);
    } catch {
      setDismissedKey(null);
    }
  }, [key]);

  if (dismissedKey === key) return null;

  function dismiss() {
    setDismissedKey(key);
    try {
      window.localStorage.setItem(key, "true");
    } catch {
      // Keep the banner dismissed for this visit even if storage is blocked.
    }
  }

  const warning = networkId === "testnet"
    ? tr("Testnet software — unaudited. Do not use with real funds.")
    : tr("Unaudited software. Do not use with real funds unless you accept the risks.");
  const dismissLabel = networkId === "testnet"
    ? tr("Dismiss testnet and unaudited software warning")
    : tr("Dismiss unaudited software warning");

  return (
    <aside
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn"
    >
      <p className="font-semibold">{warning}</p>
      <button
        type="button"
        onClick={dismiss}
        className="rounded px-2 py-1 font-medium underline underline-offset-2 hover:bg-fg/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-label={dismissLabel}
      >
        {tr("Dismiss")}
      </button>
    </aside>
  );
}
