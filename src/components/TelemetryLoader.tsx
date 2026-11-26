"use client";

import { useEffect } from "react";

/**
 * Loads performance telemetry only after the page is interactive.
 *
 * Nothing here is a static import of the telemetry client: the runtime
 * `import()` below puts the observer and payload code in its own chunk that
 * is requested after the `load` event, during an idle period. The first-load
 * bundle keeps only this effect, and the bundle budget check still runs over
 * the exported HTML where that chunk is not referenced.
 *
 * A route that never becomes idle (a busy main thread) still starts telemetry
 * within the `requestIdleCallback` timeout, so a long task cannot silently
 * drop the measurement.
 */
export function TelemetryLoader() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;

    const start = () => {
      if (cancelled) return;
      void import("@/lib/telemetry-client").then(({ startTelemetry }) => {
        if (cancelled) return;
        cleanup = startTelemetry();
      });
    };

    const whenIdle = () => {
      const requestIdle = window.requestIdleCallback;
      if (typeof requestIdle === "function") {
        idleHandle = requestIdle(start, { timeout: 3000 });
        return;
      }
      // Safari before 18 has no requestIdleCallback. A short timer still puts
      // the import after the current task and after first input handling.
      timeoutHandle = window.setTimeout(start, 200);
    };

    const onLoad = () => whenIdle();
    if (document.readyState === "complete") {
      whenIdle();
    } else {
      window.addEventListener("load", onLoad, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", onLoad);
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
      cleanup?.();
    };
  }, []);

  return null;
}
