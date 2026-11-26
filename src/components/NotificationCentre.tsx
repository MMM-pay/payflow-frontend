"use client";

import { useEffect, useId, useRef, useState, startTransition, type ReactNode } from "react";
import {
  type AppNotification,
  filterDismissedNotifications,
  readDismissedIds,
  writeDismissedIds,
} from "@/lib/notifications";
import { useI18n } from "@/i18n/provider";
import { Notice } from "@/components/ui";

export interface NotificationCentreProps {
  notifications?: AppNotification[];
  loading?: boolean;
  error?: string | null;
  address?: string | null;
  storage?: Storage;
  title?: string;
  defaultOpen?: boolean;
  onDismiss?: (id: string) => void;
  onClearAll?: () => void;
  className?: string;
}

export function NotificationCentre({
  notifications = [],
  loading = false,
  error = null,
  address,
  storage,
  title,
  defaultOpen = false,
  onDismiss,
  onClearAll,
  className = "",
}: NotificationCentreProps) {
  const { t: tr, translateMessage } = useI18n();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  // Resolve storage safely (browser window vs prop)
  const activeStorage =
    storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);

  // Load dismissed notifications when address or storage changes
  useEffect(() => {
    const loaded = readDismissedIds(activeStorage, address);
    startTransition(() => {
      setDismissed(loaded);
    });
  }, [address, activeStorage]);

  // Active (undismissed) items
  const activeItems = filterDismissedNotifications(notifications, dismissed);
  const unreadCount = activeItems.length;

  function handleDismiss(id: string) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    writeDismissedIds(activeStorage, address, next);
    onDismiss?.(id);
  }

  function handleClearAll() {
    const next = new Set(dismissed);
    for (const item of activeItems) {
      next.add(item.id);
    }
    setDismissed(next);
    writeDismissedIds(activeStorage, address, next);
    onClearAll?.();
  }

  return (
    <section
      aria-label={tr("Notification centre")}
      className={`rounded-xl border border-edge bg-card p-3 shadow-xs ${className}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && isOpen) {
          e.preventDefault();
          setIsOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      {/* Summary Trigger Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={
            loading
              ? tr("Checking notifications…")
              : unreadCount > 0
              ? `${title || tr("Notifications")} (${unreadCount})`
              : `${title || tr("Notifications")} (0)`
          }
          className="flex items-center gap-2 rounded-md py-1 px-2 text-sm font-medium hover:bg-fg/5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-hidden"
        >
          {/* Bell Icon */}
          <svg
            className="h-4 w-4 shrink-0 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
          <span>{title || tr("Notifications")}</span>

          {loading ? (
            <span
              role="status"
              aria-busy="true"
              className="inline-block h-2 w-2 animate-ping rounded-full bg-warn"
            />
          ) : unreadCount > 0 ? (
            <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger">
              {unreadCount}
            </span>
          ) : (
            <span className="rounded-full bg-fg/10 px-2 py-0.5 text-xs font-semibold text-muted">
              0
            </span>
          )}

          {/* Chevron */}
          <svg
            className={`h-3.5 w-3.5 text-muted transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && unreadCount > 0 && (
          <button
            type="button"
            onClick={handleClearAll}
            className="text-xs text-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-hidden rounded px-2 py-0.5"
          >
            {tr("Dismiss all")}
          </button>
        )}
      </div>

      {/* Expandable Notification Body */}
      {isOpen && (
        <div id={panelId} className="mt-3 border-t border-edge pt-3" aria-live="polite">
          {/* Loading State */}
          {loading && (
            <div
              role="status"
              aria-busy="true"
              className="flex items-center gap-2 py-3 text-sm text-muted"
            >
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-warn border-t-transparent" />
              <span>{tr("Checking notifications…")}</span>
            </div>
          )}

          {/* Error State */}
          {!loading && error && (
            <div role="alert" className="my-2">
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          {/* Empty State */}
          {!loading && !error && unreadCount === 0 && (
            <div
              role="status"
              className="flex flex-col items-center justify-center py-4 text-center"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="mt-2 text-sm font-medium text-fg">
                {tr("No new notifications")}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {tr("All caught up! Important notices about balances and charges will appear here.")}
              </p>
            </div>
          )}

          {/* Active Notifications List */}
          {!loading && !error && unreadCount > 0 && (
            <ul className="flex flex-col gap-2.5">
              {activeItems.map((item) => {
                const toneStyles = {
                  error: "border-danger/40 bg-danger/10 text-danger",
                  warn: "border-warn/40 bg-warn/10 text-warn",
                  info: "border-edge bg-fg/5 text-muted",
                  ok: "border-accent/40 bg-accent/10 text-accent",
                }[item.tone];

                return (
                  <li
                    key={item.id}
                    className={`flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center ${toneStyles}`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <strong className="text-sm font-semibold">{translateMessage(item.title)}</strong>
                        {item.category === "low_balance" && (
                          <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">
                            {tr("Balance")}
                          </span>
                        )}
                        {item.category === "failed_charge" && (
                          <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">
                            {tr("Failed")}
                          </span>
                        )}
                        {item.category === "unpaid_mandate" && (
                          <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">
                            {tr("Overdue")}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed opacity-90">
                        {translateMessage(item.message)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                      {item.actionLabel && (item.actionHref || item.onAction) && (
                        item.actionHref ? (
                          <a
                            href={item.actionHref}
                            className="rounded-md border border-current/30 px-2.5 py-1 text-xs font-medium hover:bg-fg/10 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-hidden"
                          >
                            {tr(item.actionLabel)}
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={item.onAction}
                            className="rounded-md border border-current/30 px-2.5 py-1 text-xs font-medium hover:bg-fg/10 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-hidden"
                          >
                            {tr(item.actionLabel)}
                          </button>
                        )
                      )}

                      <button
                        type="button"
                        onClick={() => handleDismiss(item.id)}
                        aria-label={tr("Dismiss notification: {0}", { "0": translateMessage(item.title) })}
                        className="rounded-md p-1 opacity-70 hover:opacity-100 hover:bg-fg/10 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-hidden"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
