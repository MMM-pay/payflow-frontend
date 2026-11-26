// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { TelemetryLoader } from "@/components/TelemetryLoader";

/**
 * The telemetry collector must not load until the page is interactive and the
 * browser is idle (#331). The first load's JS therefore carries only this
 * effect; this test proves the import is scheduled by idle/load rather than by
 * render, and that unmounting cancels it.
 */

const startTelemetry = vi.hoisted(() => vi.fn(() => () => {}));

vi.mock("@/lib/telemetry-client", () => ({ startTelemetry }));

type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number };
let idleCallbacks: Array<(deadline: IdleDeadline) => void>;
const cancelIdle = vi.fn();

beforeEach(() => {
  startTelemetry.mockClear();
  cancelIdle.mockClear();
  idleCallbacks = [];
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  Object.defineProperty(window, "requestIdleCallback", {
    configurable: true,
    writable: true,
    value: (callback: (deadline: IdleDeadline) => void) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    },
  });
  Object.defineProperty(window, "cancelIdleCallback", {
    configurable: true,
    writable: true,
    value: cancelIdle,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TelemetryLoader", () => {
  it("does not import the collector while the page is rendering", () => {
    render(<TelemetryLoader />);
    expect(startTelemetry).not.toHaveBeenCalled();
    expect(idleCallbacks).toHaveLength(1);
  });

  it("starts telemetry when the browser becomes idle", async () => {
    render(<TelemetryLoader />);

    act(() => {
      idleCallbacks[0]?.({ didTimeout: false, timeRemaining: () => 50 });
    });

    await waitFor(() => expect(startTelemetry).toHaveBeenCalledTimes(1));
  });

  it("waits for the load event when the document is still loading", async () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    });
    render(<TelemetryLoader />);

    expect(idleCallbacks).toHaveLength(0);
    act(() => {
      window.dispatchEvent(new Event("load"));
    });
    expect(idleCallbacks).toHaveLength(1);

    act(() => {
      idleCallbacks[0]?.({ didTimeout: false, timeRemaining: () => 50 });
    });
    await waitFor(() => expect(startTelemetry).toHaveBeenCalledTimes(1));
  });

  it("cancels a pending idle import on unmount", () => {
    const view = render(<TelemetryLoader />);
    view.unmount();
    expect(cancelIdle).toHaveBeenCalled();
  });
});
