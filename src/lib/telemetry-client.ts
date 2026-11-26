/**
 * The deferred half of performance telemetry.
 *
 * This module is loaded with a runtime `import()` from `TelemetryLoader`
 * *after* the page is interactive and the browser is idle, so `PerformanceObserver`
 * setup and the payload code never compete with the first paint. It is
 * deliberately not imported statically anywhere; `test/js-budget.test.ts`
 * guards that.
 *
 * Sending is opt-in: without `NEXT_PUBLIC_TELEMETRY_URL` the loader resolves
 * to this module but `startTelemetry` returns immediately, so a default build
 * makes no network request.
 */

import {
  buildTelemetryPayload,
  encodeTelemetry,
  telemetryEndpoint,
  type VitalName,
} from "./telemetry";

export interface StartTelemetryOptions {
  window?: Window;
  document?: Document;
  /** Overridden in tests; `undefined` reads the build-time env var. */
  endpoint?: string | null;
}

/**
 * Observe Web Vitals and send one batch when the page is hidden or unloaded.
 *
 * Returns a cleanup function that stops the observers and flushes anything
 * collected so far. Calling it twice is safe: the batch is sent once.
 */
export function startTelemetry(options: StartTelemetryOptions = {}): () => void {
  const win = options.window ?? (typeof window === "undefined" ? null : window);
  const doc = options.document ?? (typeof document === "undefined" ? null : document);
  if (!win || !doc) return () => {};

  const endpoint = options.endpoint !== undefined ? options.endpoint : telemetryEndpoint();
  if (!endpoint) return () => {};

  const latest = new Map<VitalName, number>();
  const observers: PerformanceObserver[] = [];

  // PerformanceObserver is a global in browsers but not a member of the
  // `Window` interface in lib.dom, so read it through a structural cast.
  const Observer = (win as unknown as { PerformanceObserver?: typeof PerformanceObserver })
    .PerformanceObserver;
  const observe = (type: string, handle: (entry: PerformanceEntry) => void) => {
    if (typeof Observer !== "function") return;
    try {
      const observer = new Observer((list: PerformanceObserverEntryList) => {
        for (const entry of list.getEntries()) handle(entry);
      });
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch {
      // A browser that does not know this entry type simply misses that
      // metric; the rest are still collected.
    }
  };

  observe("paint", (entry) => {
    if (entry.name === "first-contentful-paint") latest.set("FCP", entry.startTime);
  });
  observe("largest-contentful-paint", (entry) => {
    latest.set("LCP", entry.startTime);
  });
  observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & {
      value?: number;
      hadRecentInput?: boolean;
    };
    if (shift.hadRecentInput) return;
    latest.set("CLS", (latest.get("CLS") ?? 0) + (shift.value ?? 0));
  });
  observe("event", (entry) => {
    // The full INP calculation weights interactions by their paint delay.
    // The longest event duration is the conservative approximation available
    // without a third-party vitals library, and still flags slow input.
    const event = entry as PerformanceEntry & { duration?: number };
    if (typeof event.duration !== "number") return;
    latest.set("INP", Math.max(latest.get("INP") ?? 0, event.duration));
  });

  const navigation = win.performance?.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (navigation && Number.isFinite(navigation.responseStart)) {
    latest.set("TTFB", Math.max(0, navigation.responseStart - navigation.startTime));
  }

  let sent = false;
  const flush = () => {
    if (sent || latest.size === 0) return;
    sent = true;
    const payload = buildTelemetryPayload(
      win.location.pathname,
      Array.from(latest, ([name, value]) => ({ name, value })),
    );
    const body = encodeTelemetry(payload);

    // sendBeacon survives the page being torn down, which is exactly when the
    // final vitals (LCP, INP) are known. Fetch with keepalive is the fallback.
    const beacon = win.navigator?.sendBeacon;
    const delivered =
      typeof beacon === "function" &&
      beacon.call(win.navigator, endpoint, new Blob([body], { type: "text/plain;charset=UTF-8" }));
    if (!delivered && typeof win.fetch === "function") {
      void win
        .fetch(endpoint, {
          method: "POST",
          body,
          keepalive: true,
          headers: { "content-type": "text/plain;charset=UTF-8" },
        })
        .catch(() => undefined);
    }
  };

  const onVisibilityChange = () => {
    if (doc.visibilityState === "hidden") flush();
  };
  const onPageHide = () => flush();

  doc.addEventListener("visibilitychange", onVisibilityChange);
  win.addEventListener("pagehide", onPageHide);

  return () => {
    for (const observer of observers) observer.disconnect();
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    win.removeEventListener("pagehide", onPageHide);
    flush();
  };
}
