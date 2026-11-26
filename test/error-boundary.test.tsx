// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { AnchorHTMLAttributes } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { ErrorRecovery } from "@/components/ErrorRecovery";
import ErrorRouteFallback from "@/app/error";
import Loading from "@/app/loading";
import NotFound from "@/app/not-found";
import { I18nProvider, LOCALE_STORAGE_KEY } from "@/i18n/provider";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("ErrorRecovery", () => {
  it("announces an accessible, theme-aware error and exposes both recovery actions", () => {
    const retry = vi.fn();
    const reload = vi.fn();
    renderWithI18n(<ErrorRecovery detail="boom" onRetry={retry} onReload={reload} />);

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-labelledby")).toBe("app-error-title");
    expect(alert.getAttribute("aria-describedby")).toBe("app-error-description");
    expect(alert.className).toContain("panel");
    expect(screen.getByText("Something went wrong").className).toContain("text-danger");
    expect(screen.getByRole("heading", { level: 1, name: "We couldn't load this page." }).className).toContain("text-fg");
    expect(screen.getByText("Your payment settings are safe. Try again, or reload the page.")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("uses a generic fallback without details and localizes the copy", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    renderWithI18n(<ErrorRecovery onRetry={vi.fn()} onReload={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Nous n’avons pas pu charger cette page." })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Réessayer" })).toBeTruthy();
    expect(screen.queryByText("Détails techniques")).toBeNull();
  });
});

describe("AppErrorBoundary", () => {
  function Bomb({ fail }: { fail: boolean }) {
    if (fail) throw new Error("boom");
    return <p>Page recovered</p>;
  }

  function Harness() {
    const [fail, setFail] = useState(true);
    return (
      <AppErrorBoundary onRetry={() => setFail(false)}>
        <Bomb fail={fail} />
      </AppErrorBoundary>
    );
  }

  it("renders children unchanged when nothing throws", () => {
    renderWithI18n(
      <AppErrorBoundary>
        <p>Page ready</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("Page ready")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("replaces a thrown child with the fallback and remounts it on retry", () => {
    renderWithI18n(<Harness />);
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Page recovered")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("route-level states", () => {
  it("uses the Next reset action for retry", () => {
    const reset = vi.fn();
    renderWithI18n(<ErrorRouteFallback error={new Error("boom")} reset={reset} />);

    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("reloads the route from the fallback", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    renderWithI18n(<ErrorRouteFallback error={new Error("boom")} reset={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("announces the loading fallback", () => {
    renderWithI18n(<Loading />);

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toContain("Loading");
  });

  it("keeps the empty route state meaningful and themed", () => {
    render(<NotFound />);

    expect(screen.getByText("404").className).toContain("text-muted");
    expect(screen.getByRole("heading", { name: "Page not found" }).className).toContain("text-fg");
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
  });
});
