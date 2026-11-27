// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ConnectionBanner,
  useConnectionStatus,
  type ConnectionStatusOptions,
} from "@/components/ConnectionBanner";
import { I18nProvider } from "@/i18n/provider";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

function StatusProbe(options: ConnectionStatusOptions & { retryLabel?: string }) {
  const { status, checking, episode, retry } = useConnectionStatus(options);
  return (
    <>
      <output data-testid="status">{`${status}:${checking}:${episode}`}</output>
      <button type="button" onClick={retry}>{options.retryLabel ?? "check"}</button>
    </>
  );
}

describe("ConnectionBanner (#339)", () => {
  it("renders nothing in healthy, still-checking and contract-only states", () => {
    const { rerender } = renderWithI18n(<ConnectionBanner status="ok" checking />);
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    rerender(<I18nProvider><ConnectionBanner status="contract-only" /></I18nProvider>);
    expect(screen.queryByTestId("connection-banner")).toBeNull();
  });

  it("announces an offline device politely and can be dismissed", () => {
    renderWithI18n(<ConnectionBanner status="offline" />);
    const banner = screen.getByTestId("connection-banner");
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(banner.className).toContain("border-warn/40");
    expect(banner.textContent).toContain("Connection lost");
    expect(banner.textContent).toContain("Contract-backed pages stay available");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss connection notice" }));
    expect(screen.queryByTestId("connection-banner")).toBeNull();
  });

  it("announces an unreachable backend, exposes loading and retry, and uses error colours", () => {
    const onRetry = vi.fn();
    renderWithI18n(<ConnectionBanner status="unreachable" checking onRetry={onRetry} />);
    const banner = screen.getByTestId("connection-banner");
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.getAttribute("aria-live")).toBe("assertive");
    expect(banner.getAttribute("aria-busy")).toBe("true");
    expect(banner.className).toContain("border-danger/40");
    expect(banner.textContent).toContain("Backend is unreachable");
    expect(banner.textContent).toContain("Checking connection…");

    const retry = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss connection notice" }));
    expect(screen.queryByTestId("connection-banner")).toBeNull();
  });

  it("shows a new state after a different problem, even if the previous one was dismissed", () => {
    const { rerender } = renderWithI18n(<ConnectionBanner status="offline" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss connection notice" }));
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    rerender(<I18nProvider><ConnectionBanner status="unreachable" /></I18nProvider>);
    expect(screen.getByTestId("connection-banner").textContent).toContain("Backend is unreachable");
  });

  it("shows a later outage of the same kind after a dismissal", () => {
    const { rerender } = renderWithI18n(<ConnectionBanner status="unreachable" episode={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss connection notice" }));
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    rerender(<I18nProvider><ConnectionBanner status="unreachable" episode={2} /></I18nProvider>);
    expect(screen.getByTestId("connection-banner").textContent).toContain("Backend is unreachable");
  });

  it("probes the backend once when online and escalates a failed answer", async () => {
    const probe = vi.fn().mockResolvedValue(false);
    renderWithI18n(<StatusProbe configured probe={probe} isOnline={() => true} />);
    expect(screen.getByTestId("status").textContent).toBe("ok:true:0");
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unreachable:false:1"));
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("never probes while the device is offline and rechecks when it comes back", async () => {
    let online = false;
    const probe = vi.fn().mockResolvedValue(true);
    renderWithI18n(<StatusProbe configured probe={probe} isOnline={() => online} />);
    expect(screen.getByTestId("status").textContent).toBe("offline:false:0");
    expect(probe).not.toHaveBeenCalled();

    online = true;
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ok:false:0"));
    expect(probe).toHaveBeenCalledTimes(1);

    online = false;
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByTestId("status").textContent).toBe("offline:false:1");
  });

  it("retries on demand and clears a caught probe error", async () => {
    const probe = vi.fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(true);
    renderWithI18n(<StatusProbe configured probe={probe} isOnline={() => true} />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unreachable:false:1"));
    fireEvent.click(screen.getByRole("button", { name: "check" }));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ok:false:1"));
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("starts a new episode after recovering and failing again", async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    renderWithI18n(<StatusProbe configured probe={probe} isOnline={() => true} />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unreachable:false:1"));
    fireEvent.click(screen.getByRole("button", { name: "check" }));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ok:false:1"));
    fireEvent.click(screen.getByRole("button", { name: "check" }));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unreachable:false:2"));
  });
});
