// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToastHook } from "@/components/Toast";
import { I18nProvider } from "@/i18n/provider";

function ToastTrigger() {
  const { toast } = useToastHook();
  return (
    <button
      type="button"
      onClick={() => toast({ title: "Saved", description: "Your plan was saved." })}
    >
      Show toast
    </button>
  );
}

function renderToast() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ToastProvider", () => {
  it("announces new notifications and dismisses them with Escape", () => {
    renderToast();
    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));

    const announcement = screen.getByRole("status");
    expect(announcement.getAttribute("aria-live")).toBe("polite");
    expect(announcement.textContent).toContain("Saved. Your plan was saved.");
    expect(screen.getByRole("group", { name: "Saved" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("group", { name: "Saved" })).toBeNull();
  });

  it("keeps a toast open when Escape belongs to a dialog", () => {
    render(
      <I18nProvider>
        <ToastProvider>
          <ToastTrigger />
          <div role="dialog" aria-label="Confirmation">
            <button type="button">Confirm</button>
          </div>
        </ToastProvider>
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));

    fireEvent.keyDown(screen.getByRole("button", { name: "Confirm" }), {
      key: "Escape",
    });

    expect(screen.getByRole("group", { name: "Saved" })).toBeTruthy();
  });

  it("provides a labelled keyboard-focusable dismiss button", () => {
    renderToast();
    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));

    const dismiss = screen.getByRole("button", { name: "Dismiss notification" });
    expect(dismiss.tagName).toBe("BUTTON");
    fireEvent.click(dismiss);

    expect(screen.queryByRole("group", { name: "Saved" })).toBeNull();
  });
});
