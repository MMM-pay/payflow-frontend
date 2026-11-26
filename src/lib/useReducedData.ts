import { useSyncExternalStore } from "react";

interface NetworkInformationLike {
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

interface ReducedDataWindowLike {
  matchMedia?: (query: string) => {
    matches: boolean;
    addEventListener?: (type: "change", listener: () => void) => void;
    removeEventListener?: (type: "change", listener: () => void) => void;
  };
  navigator?: object & {
    connection?: NetworkInformationLike;
  };
}

/**
 * Pure detector for reduced-data preferences (`prefers-reduced-data: reduce`
 * media query or Network Information API `navigator.connection.saveData`).
 */
export function detectReducedData(
  win: ReducedDataWindowLike | undefined = typeof window !== "undefined" ? window : undefined,
): boolean {
  if (!win) return false;
  const mediaMatches =
    typeof win.matchMedia === "function" &&
    Boolean(win.matchMedia("(prefers-reduced-data: reduce)")?.matches);
  const connection = (win.navigator as { connection?: NetworkInformationLike } | undefined)
    ?.connection;
  const saveData = Boolean(connection?.saveData);
  return mediaMatches || saveData;
}

function subscribeReducedData(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const query =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-data: reduce)")
      : null;
  const connection = (window.navigator as { connection?: NetworkInformationLike } | undefined)
    ?.connection;

  query?.addEventListener?.("change", onChange);
  connection?.addEventListener?.("change", onChange);

  return () => {
    query?.removeEventListener?.("change", onChange);
    connection?.removeEventListener?.("change", onChange);
  };
}

/**
 * Tracks the user's reduced-data preference (`prefers-reduced-data: reduce` or
 * `navigator.connection.saveData`) so heavy optional assets can be deferred.
 * Returns `false` during SSR and initial hydration, then syncs on the client.
 */
export function useReducedData(): boolean {
  return useSyncExternalStore(subscribeReducedData, () => detectReducedData(), () => false);
}
