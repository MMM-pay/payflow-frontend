// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTelemetry } from "@/lib/telemetry-client";
import { buildTelemetryPayload, encodeTelemetry } from "@/lib/telemetry";

/**
 * The deferred collector's send path (#331): the batch is delivered once, on
 * hide/unload, and only when an endpoint is configured. This is what keeps a
 * default build silent while still proving the configured feature works.
 */

type ObserverCallback = (list: { getEntries: () => PerformanceEntry[] }) => void;

const originalObserver = window.PerformanceObserver;
const originalBeacon = navigator.sendBeacon;

afterEach(() => {
  Object.defineProperty(window, "PerformanceObserver", {
    configurable: true,
    value: originalObserver,
  });
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: originalBeacon,
  });
});

function installFakeObserver() {
  const callbacks = new Map<string, ObserverCallback>();
  class FakeObserver {
    constructor(callback: ObserverCallback) {
      this.callback = callback;
    }
    callback: ObserverCallback;
    observe = ({ type }: { type: string }) => {
      callbacks.set(type, this.callback);
    };
    disconnect = vi.fn();
  }
  Object.defineProperty(window, "PerformanceObserver", {
    configurable: true,
    value: FakeObserver,
  });
  return {
    emit(type: string, entry: PerformanceEntry) {
      callbacks.get(type)?.({ getEntries: () => [entry] });
    },
  };
}

describe("startTelemetry", () => {
  it("makes no observers or requests without an endpoint", () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });

    const cleanup = startTelemetry({ endpoint: null });
    cleanup();

    expect(beacon).not.toHaveBeenCalled();
    expect(window.performance.getEntriesByType).toBeDefined();
  });

  it("beacons one batched payload on cleanup", async () => {
    const observer = installFakeObserver();
    const beacon = vi.fn<(url: string, body: Blob) => boolean>(() => true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });

    const cleanup = startTelemetry({ endpoint: "https://vitals.example.test/collect" });
    observer.emit("paint", {
      name: "first-contentful-paint",
      startTime: 120,
    } as PerformanceEntry);
    observer.emit("largest-contentful-paint", {
      name: "",
      startTime: 900,
    } as PerformanceEntry);
    observer.emit("layout-shift", {
      name: "",
      startTime: 0,
      value: 0.05,
      hadRecentInput: false,
    } as unknown as PerformanceEntry);
    observer.emit("event", {
      name: "",
      startTime: 0,
      duration: 90,
    } as PerformanceEntry);

    cleanup();
    cleanup();

    // A second cleanup after the first must not send the batch again.
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]?.[0]).toBe("https://vitals.example.test/collect");

    const sent = beacon.mock.calls[0];
    if (!sent) throw new Error("expected one beacon");
    const payload = JSON.parse(await sent[1].text());
    expect(payload.page).toBe("/");
    expect(payload.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "FCP", value: 120, rating: "good" }),
        expect.objectContaining({ name: "LCP", value: 900, rating: "good" }),
        expect.objectContaining({ name: "CLS", value: 0.05, rating: "good" }),
        expect.objectContaining({ name: "INP", value: 90, rating: "good" }),
      ]),
    );
  });

  it("uses the same encoded body as the pure helpers", async () => {
    const observer = installFakeObserver();
    const beacon = vi.fn<(url: string, body: Blob) => boolean>(() => true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });

    const cleanup = startTelemetry({ endpoint: "https://vitals.example.test/collect" });
    observer.emit("largest-contentful-paint", {
      name: "",
      startTime: 300,
    } as PerformanceEntry);
    cleanup();

    const sent = beacon.mock.calls[0];
    if (!sent) throw new Error("expected one beacon");
    const received = JSON.parse(await sent[1].text());
    const expected = buildTelemetryPayload("/", [{ name: "LCP", value: 300 }]);
    // `at` is the only field the collector fills at send time.
    expect(received.metrics).toEqual(expected.metrics);
    expect(received.page).toBe(expected.page);
    expect(received.at).toBeTypeOf("number");
    expect(JSON.parse(encodeTelemetry(expected)).metrics).toEqual(received.metrics);
  });
});
