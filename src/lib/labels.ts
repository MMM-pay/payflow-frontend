"use client";

import { useEffect, useState } from "react";

/**
 * Local, private labels for addresses.
 *
 * A string of `G…` addresses is unreadable, and the protocol has no notion of
 * a contact name. This keeps one on the reader's own device: a label never
 * leaves the browser, is never signed, and is never shown to anyone else. That
 * makes it work in contract-only mode — there is no backend involved at all —
 * and it can never be mistaken for a verified merchant name.
 *
 * Everything here fails quietly. Private-mode Safari and a site whose storage
 * is blocked throw from `localStorage` itself, not just from its methods, so
 * every access is guarded and the app keeps working without labels.
 */

/** Labels are for recognising a row at a glance, not for notes. */
export const LABEL_MAX_LENGTH = 40;

/** One key per address, so a stale write cannot clobber every other label. */
const KEY_PREFIX = "payflow.address-label.";

/** Fired on `window` after a label changes in this tab (`storage` covers others). */
const CHANGE_EVENT = "payflow:labels-changed";

/**
 * A label as it will be stored: surrounding whitespace and runs of whitespace
 * collapsed, then clamped to `LABEL_MAX_LENGTH`. An empty result means "no
 * label", which is how removing one is expressed.
 */
export function normalizeLabel(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX_LENGTH).trim();
}

export function labelStorageKey(address: string): string {
  return `${KEY_PREFIX}${address}`;
}

/**
 * The browser's `localStorage`, or null when it is unavailable or blocked.
 *
 * Merely reading `window.localStorage` can throw when storage is disabled, so
 * that access is inside the guard too.
 */
export function labelStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The label stored for an address, or null when there is none or it is unreadable. */
export function readLabel(
  address: string,
  storage: Storage | null = labelStorage(),
): string | null {
  if (!address || !storage) return null;
  try {
    return normalizeLabel(storage.getItem(labelStorageKey(address))) || null;
  } catch {
    return null;
  }
}

export type LabelWrite = { ok: true; label: string | null } | { ok: false };

/**
 * Store a label, or remove it when `raw` normalises to empty.
 *
 * `ok: false` means the browser refused the write — the caller may tell the
 * user, but the page must carry on as if labels did not exist.
 */
export function saveLabel(
  address: string,
  raw: string,
  storage: Storage | null = labelStorage(),
): LabelWrite {
  const label = normalizeLabel(raw);
  if (!address || !storage) return { ok: false };
  try {
    if (label) {
      storage.setItem(labelStorageKey(address), label);
    } else {
      storage.removeItem(labelStorageKey(address));
    }
    announceLabelChange();
    return { ok: true, label: label || null };
  } catch {
    return { ok: false };
  }
}

/** Remove a stored label; `false` means storage refused the write. */
export function removeLabel(
  address: string,
  storage: Storage | null = labelStorage(),
): boolean {
  return saveLabel(address, "", storage).ok;
}

function announceLabelChange(): void {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // A page that cannot dispatch an event still saves the label; the next
    // read sees it.
  }
}

/**
 * Call `listener` when a label changes in this tab or another one.
 * Returns an unsubscribe function.
 */
export function subscribeToLabels(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    // `key` is null when another tab clears all storage.
    if (event.key === null || event.key.startsWith(KEY_PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

/**
 * The label for an address, kept in sync across every `AddressLink` on the
 * page. Starts as null and reads after mount: the static export is prerendered
 * without a window, so reading storage in the initial state would make the
 * server and client markup disagree.
 */
export function useAddressLabel(address: string | null | undefined): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setLabel(null);
      return;
    }
    const sync = () => setLabel(readLabel(address));
    sync();
    return subscribeToLabels(sync);
  }, [address]);

  return label;
}
