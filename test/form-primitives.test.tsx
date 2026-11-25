// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { FieldHint, InlineError } from "@/components/ui";
import { I18nProvider, LOCALE_STORAGE_KEY } from "@/i18n/provider";

afterEach(() => {
  cleanup();
  try {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    // Storage is optional.
  }
});

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("InlineError", () => {
  it("renders one alert paragraph with the control's id", () => {
    renderWithI18n(<InlineError id="name-error">Enter a name.</InlineError>);
    const alert = screen.getByRole("alert");
    expect(alert.id).toBe("name-error");
    expect(alert.textContent).toBe("Enter a name.");
    expect(alert.className).toContain("text-danger");
  });

  it("renders nothing when there is no message", () => {
    const { container } = renderWithI18n(
      <InlineError id="empty-error">{""}</InlineError>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("translates application-generated messages", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    renderWithI18n(<InlineError id="amount-error">At most 6 decimal places.</InlineError>);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Au maximum 6 décimales.",
      );
    });
  });
});

describe("FieldHint", () => {
  it("renders muted help text with the control's id", () => {
    renderWithI18n(<FieldHint id="amount-hint">Accepts 5 or 5.0.</FieldHint>);
    const hint = screen.getByText("Accepts 5 or 5.0.");
    expect(hint.id).toBe("amount-hint");
    expect(hint.className).toContain("text-muted");
    expect(hint.getAttribute("aria-live")).toBeNull();
  });

  it("announces live summaries politely", () => {
    renderWithI18n(
      <FieldHint id="coverage" live>
        5 XLM covers 2 periods.
      </FieldHint>,
    );
    expect(screen.getByText("5 XLM covers 2 periods.").getAttribute("aria-live")).toBe(
      "polite",
    );
  });

  it("renders nothing when there is no hint", () => {
    const { container } = renderWithI18n(<FieldHint id="hint">{null}</FieldHint>);
    expect(container.firstChild).toBeNull();
  });
});
