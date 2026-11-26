// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StaleDataNotice } from "@/components/StaleDataNotice";
import { I18nProvider } from "@/i18n/provider";

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);

afterEach(cleanup);

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("StaleDataNotice", () => {
  it("renders nothing while the figures are fresh", () => {
    const { container } = renderWithI18n(
      <StaleDataNotice fetchedAt={NOW - 1_000} now={NOW} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("prompts a refresh with a live warning when data is stale", () => {
    const onRefresh = vi.fn();
    renderWithI18n(
      <StaleDataNotice
        fetchedAt={NOW - 10 * 60_000}
        now={NOW}
        onRefresh={onRefresh}
      />,
    );
    const notice = screen.getByRole("status");
    expect(notice.getAttribute("aria-live")).toBe("polite");
    expect(notice.textContent).toContain("Refresh to see the latest activity.");
    expect(notice.textContent).toContain("10 minutes ago");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("explains a failed refresh assertively and keeps the last update time", () => {
    renderWithI18n(
      <StaleDataNotice
        fetchedAt={NOW - 500}
        now={NOW}
        error="Network unavailable"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "Could not refresh. Showing figures last updated just now.",
    );
    expect(alert.textContent).toContain("Network unavailable");
  });

  it("handles a first load with no figures yet", () => {
    const onRefresh = vi.fn();
    renderWithI18n(
      <StaleDataNotice fetchedAt={null} now={NOW} showLoading onRefresh={onRefresh} />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "These figures have not loaded yet.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows a busy status during the first load", () => {
    renderWithI18n(
      <StaleDataNotice fetchedAt={null} now={NOW} refreshing showLoading />,
    );
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toContain("Loading figures…");
  });

  it("can expose an up-to-date status to assistive technology", () => {
    renderWithI18n(
      <StaleDataNotice fetchedAt={NOW - 1_000} now={NOW} renderFresh />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "These figures are up to date.",
    );
  });

  it("uses the backend freshness report even when the local fetch is recent", () => {
    renderWithI18n(
      <StaleDataNotice
        fetchedAt={NOW - 1_000}
        now={NOW}
        freshnessSeconds={900}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Refresh to see the latest activity.",
    );
  });
});
