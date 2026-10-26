"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type ApiActivityType,
  type ApiMandate,
  type ApiTimelineEvent,
} from "@/lib/api";
import { config } from "@/lib/config";
import { formatAmount, type TokenMeta } from "@/lib/format";
import { useWallet } from "@/lib/wallet";
import { Empty, Notice, Panel, SkeletonRows } from "@/components/ui";

const SEEN_PREFIX = "payflow.activity.seen.";

export interface ActivityItem extends ApiTimelineEvent {
  identity: string;
}

interface ActivityLoad {
  items: ActivityItem[];
  failedRequests: number;
  totalRequests: number;
  mandateSourcesFailed: number;
}

function isMandatePage(value: unknown): value is { mandates: ApiMandate[] } {
  if (!value || typeof value !== "object") return false;
  const mandates = (value as { mandates?: unknown }).mandates;
  return (
    Array.isArray(mandates) &&
    mandates.every(
      (mandate) =>
        mandate &&
        typeof mandate === "object" &&
        typeof (mandate as { id?: unknown }).id === "number" &&
        Number.isSafeInteger((mandate as { id: number }).id) &&
        (mandate as { id: number }).id > 0,
    )
  );
}

function storageKey(address: string): string {
  return `${SEEN_PREFIX}${address}`;
}

function readSeen(address: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(address));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeSeen(address: string, seen: Set<string>): void {
  try {
    window.localStorage.setItem(storageKey(address), JSON.stringify([...seen]));
  } catch {
    // Local storage is optional; the in-memory state remains usable.
  }
}

function eventIdentity(event: ApiTimelineEvent): string {
  return `${event.mandate_id}:${event.event_id}`;
}

function compareEvents(a: ActivityItem, b: ActivityItem): number {
  return (
    b.ledger - a.ledger ||
    (b.event_index ?? -1) - (a.event_index ?? -1) ||
    a.event_id.localeCompare(b.event_id)
  );
}

function labelFor(type: ApiActivityType): string {
  return type.replaceAll("_", " ");
}

function tokenMetaFor(event: ActivityItem): TokenMeta | null {
  if (
    !event.token ||
    !event.token_symbol ||
    event.token_decimals === null ||
    event.token_decimals === undefined
  ) {
    return null;
  }
  return { symbol: event.token_symbol, decimals: event.token_decimals };
}

function eventDescription(event: ActivityItem): string {
  if (event.type === "charged") {
    if (!event.amount) return "Payment charged";
    const meta = tokenMetaFor(event);
    return meta
      ? `Charged ${formatAmount(event.amount, meta)}`
      : `Charged ${event.amount} (smallest units; token metadata unavailable)`;
  }
  switch (event.type) {
    case "pause_changed":
      return "Pause status changed";
    case "mandate_completed":
      return "Mandate completed";
    case "mandate_ended":
      return "Mandate ended";
    case "cancelled":
      return "Mandate cancelled";
    case "subscribed":
      return "Mandate subscribed";
  }
}

async function loadActivity(address: string): Promise<ActivityLoad | null> {
  const roleResults = await Promise.allSettled([
    api.mandatesOf(address),
    api.mandatesFor(address),
  ]);
  const mandates = new Map<number, ApiMandate>();
  let mandateSourcesFailed = 0;

  roleResults.forEach((result) => {
    if (
      result.status === "fulfilled" &&
      isMandatePage(result.value)
    ) {
      result.value.mandates.forEach((mandate) => mandates.set(mandate.id, mandate));
    } else {
      mandateSourcesFailed += 1;
    }
  });

  if (mandateSourcesFailed === roleResults.length) return null;

  const timelineResults = await Promise.allSettled(
    [...mandates.keys()].map(async (mandateId) => api.timeline(mandateId)),
  );
  const items = new Map<string, ActivityItem>();
  let failedRequests = 0;

  timelineResults.forEach((result) => {
    if (result.status !== "fulfilled" || result.value === null) {
      failedRequests += 1;
      return;
    }
    result.value.events.forEach((event) => {
      items.set(eventIdentity(event), { ...event, identity: eventIdentity(event) });
    });
  });

  return {
    items: [...items.values()].sort(compareEvents),
    failedRequests,
    totalRequests: timelineResults.length,
    mandateSourcesFailed,
  };
}

export function Activity() {
  const { address } = useWallet();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [itemsAddress, setItemsAddress] = useState<string | null>(null);
  const [seenAddress, setSeenAddress] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [partial, setPartial] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(false);

  const refresh = useCallback(async (walletAddress: string) => {
    const requestGeneration = ++generation.current;
    setLoading(true);
    setFailed(false);
    const loaded = await loadActivity(walletAddress);
    if (!mounted.current || requestGeneration !== generation.current) return;
    if (loaded === null) {
      setFailed(true);
      setPartial(false);
    } else {
      setItems(loaded.items);
      setItemsAddress(walletAddress);
      const allTimelinesFailed =
        loaded.totalRequests > 0 &&
        loaded.failedRequests === loaded.totalRequests &&
        loaded.items.length === 0;
      setPartial(
        !allTimelinesFailed &&
          (loaded.failedRequests > 0 || loaded.mandateSourcesFailed > 0),
      );
      setFailed(allTimelinesFailed);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    setItems([]);
    setFailed(false);
    setPartial(false);
    setSeen(address ? readSeen(address) : new Set());
    setSeenAddress(address);
    if (address && api.isConfigured()) void refresh(address);
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [address, refresh]);

  const visibleItems = useMemo(
    () => (itemsAddress === address ? items : []),
    [itemsAddress, address, items],
  );
  const visibleSeen = useMemo(
    () => (seenAddress === address ? seen : new Set<string>()),
    [seenAddress, address, seen],
  );

  const unread = useMemo(
    () => visibleItems.filter((item) => !visibleSeen.has(item.identity)),
    [visibleItems, visibleSeen],
  );

  const markSeen = () => {
    if (!address || unread.length === 0) return;
    const next = new Set(visibleSeen);
    unread.forEach((item) => next.add(item.identity));
    setSeen(next);
    writeSeen(address, next);
  };

  if (!api.isConfigured() || !address) return null;

  return (
    <Panel
      title="Activity"
      subtitle={unread.length ? `${unread.length} unread` : "Recent mandate activity"}
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void refresh(address)}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={markSeen}
            disabled={!unread.length}
          >
            Mark all read
          </button>
        </div>
      }
    >
      {loading ? <SkeletonRows rows={3} label="Loading activity" /> : null}
      {!loading && partial ? (
        <Notice tone="info">
          Some activity could not be loaded. The list below may be incomplete.
        </Notice>
      ) : null}
      {!loading && failed ? (
        <div className="space-y-3">
          <Notice tone="error">Activity is unavailable right now. Try again later.</Notice>
          <button type="button" className="btn-ghost" onClick={() => void refresh(address)}>
            Try again
          </button>
        </div>
      ) : null}
      {!loading && !failed && !partial && visibleItems.length === 0 ? (
        <Empty>No activity yet.</Empty>
      ) : null}
      {!loading && !failed && visibleItems.length > 0 ? (
        <ol className="space-y-3" aria-label="Wallet activity">
          {visibleItems.map((item) => (
            <li
              key={item.identity}
              className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-edge p-3"
            >
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{eventDescription(item)}</p>
                <p className="mt-1 break-words text-xs text-muted">
                  {labelFor(item.type)} | mandate #{item.mandate_id} | ledger {item.ledger}
                </p>
              </div>
              {!visibleSeen.has(item.identity) ? (
                <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                  New
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </Panel>
  );
}
