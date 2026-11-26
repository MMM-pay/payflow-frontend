// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { SyncLagIndicator } from "@/components/SyncLagIndicator";
import { I18nProvider, LOCALE_STORAGE_KEY } from "@/i18n/provider";
import { api } from "@/lib/api";

const storageMap = new Map<string, string>();
const storageMock = {
  getItem: (k: string) => storageMap.get(k) ?? null,
  setItem: (k: string, v: string) => { storageMap.set(k, String(v)); },
  removeItem: (k: string) => { storageMap.delete(k); },
  clear: () => { storageMap.clear(); },
};

try {
  Object.defineProperty(window, "localStorage", {
    value: storageMock,
    configurable: true,
    writable: true,
  });
} catch {
  // ignored
}

afterEach(() => {
  cleanup();
  storageMap.clear();
});

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("SyncLagIndicator", () => {
  describe("Explicit state prop", () => {
    it("renders nothing by default when synced", () => {
      const { container } = renderWithI18n(
        <SyncLagIndicator
          state={{
            state: "synced",
            isCatchingUp: false,
            lag: 0,
            status: "ok",
          }}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders sr-only empty element when renderEmpty is true", () => {
      renderWithI18n(
        <SyncLagIndicator
          renderEmpty
          state={{
            state: "synced",
            isCatchingUp: false,
            lag: 0,
            status: "ok",
          }}
        />,
      );
      const emptyEl = screen.getByTestId("sync-lag-empty");
      expect(emptyEl).toBeDefined();
      expect(emptyEl.textContent).toContain("Backend is in sync");
    });

    it("renders subtle catching_up indicator with lag count and accessible role", () => {
      renderWithI18n(
        <SyncLagIndicator
          state={{
            state: "catching_up",
            isCatchingUp: true,
            lag: 18,
            status: "catching_up",
            paused: false,
          }}
        />,
      );
      const indicator = screen.getByTestId("sync-lag-indicator");
      expect(indicator).toBeDefined();
      expect(indicator.getAttribute("role")).toBe("status");
      expect(indicator.getAttribute("aria-live")).toBe("polite");
      expect(indicator.textContent).toContain("Backend is catching up (18 ledgers behind) — numbers may lag on-chain activity.");
      // Check theme-aware classes
      expect(indicator.className).toContain("text-warn");
      expect(indicator.className).toContain("bg-warn/10");
      expect(indicator.className).toContain("border-warn/40");
    });

    it("renders catching_up indicator in French when locale is fr", async () => {
      storageMock.setItem(LOCALE_STORAGE_KEY, "fr");
      renderWithI18n(
        <SyncLagIndicator
          state={{
            state: "catching_up",
            isCatchingUp: true,
            lag: 18,
            status: "catching_up",
            paused: false,
          }}
        />,
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: LOCALE_STORAGE_KEY,
          newValue: "fr",
        }),
      );
      await waitFor(() => {
        const indicator = screen.getByTestId("sync-lag-indicator");
        expect(indicator.textContent).toContain("Le backend rattrape son retard (18 registres de retard)");
      });
    });

    it("renders paused operator indicator when indexing is paused", () => {
      renderWithI18n(
        <SyncLagIndicator
          state={{
            state: "catching_up",
            isCatchingUp: true,
            lag: 5,
            status: "ok",
            paused: true,
          }}
        />,
      );
      const indicator = screen.getByTestId("sync-lag-indicator");
      expect(indicator.textContent).toContain("Indexing paused by an operator");
    });

    it("renders fallback text when lag is null or not provided", () => {
      renderWithI18n(
        <SyncLagIndicator
          state={{
            state: "catching_up",
            isCatchingUp: true,
            lag: null,
            status: "catching_up",
          }}
        />,
      );
      const indicator = screen.getByTestId("sync-lag-indicator");
      expect(indicator.textContent).toContain("Backend is catching up — numbers may lag on-chain activity.");
    });

    it("does not fetch backend state when an explicit state override is supplied", () => {
      vi.spyOn(api, "isConfigured").mockReturnValue(true);
      const health = vi.spyOn(api, "health");

      renderWithI18n(
        <SyncLagIndicator
          state={{
            state: "catching_up",
            isCatchingUp: true,
            lag: 18,
            status: "catching_up",
          }}
        />,
      );

      expect(health).not.toHaveBeenCalled();
    });

    it("renders loading state only when showLoading is true", () => {
      const { container, rerender } = renderWithI18n(
        <SyncLagIndicator state={{ loading: true, isCatchingUp: false }} />,
      );
      expect(container.firstChild).toBeNull();

      rerender(
        <I18nProvider>
          <SyncLagIndicator state={{ loading: true, isCatchingUp: false }} showLoading />
        </I18nProvider>,
      );
      const loadingEl = screen.getByTestId("sync-lag-loading");
      expect(loadingEl.getAttribute("aria-busy")).toBe("true");
      expect(loadingEl.textContent).toContain("Checking backend sync…");
    });

    it("renders error state only when showError is true", () => {
      const { container, rerender } = renderWithI18n(
        <SyncLagIndicator
          state={{
            state: "error",
            error: "Connection timeout",
            isCatchingUp: false,
          }}
        />,
      );
      expect(container.firstChild).toBeNull();

      rerender(
        <I18nProvider>
          <SyncLagIndicator
            state={{
              state: "error",
              error: "Connection timeout",
              isCatchingUp: false,
            }}
            showError
          />
        </I18nProvider>,
      );
      const errorEl = screen.getByTestId("sync-lag-error");
      expect(errorEl.textContent).toContain("Backend sync status unavailable");
      expect(errorEl.textContent).toContain("Connection timeout");
    });
  });

  describe("Hook integration with api.health", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("renders nothing in contract-only mode (api not configured)", async () => {
      vi.spyOn(api, "isConfigured").mockReturnValue(false);
      const { container } = renderWithI18n(<SyncLagIndicator />);
      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it("surfaces lag when api is configured and backend reports lag", async () => {
      vi.spyOn(api, "isConfigured").mockReturnValue(true);
      vi.spyOn(api, "health").mockResolvedValue({
        status: "catching_up",
        network: "testnet",
        indexer: {
          cursor: 500,
          latestLedger: 532,
          lag: 32,
          paused: false,
          freshnessSeconds: 90,
          lastRunAt: "2026-11-24T20:00:00.000Z",
          lastError: null,
        },
      });

      renderWithI18n(<SyncLagIndicator />);

      await waitFor(() => {
        const indicator = screen.getByTestId("sync-lag-indicator");
        expect(indicator.textContent).toContain("Backend is catching up (32 ledgers behind)");
      });
    });

    it("fails soft when api.health returns null", async () => {
      vi.spyOn(api, "isConfigured").mockReturnValue(true);
      vi.spyOn(api, "health").mockResolvedValue(null);

      const { container } = renderWithI18n(<SyncLagIndicator />);
      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });
  });
});
