// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Money, parseMoneyValue } from "@/components/Money";
import { I18nProvider } from "@/i18n/provider";
import { XLM, type TokenMeta } from "@/lib/format";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem("payflow.locale");
});

const USDC: TokenMeta = { symbol: "USDC", decimals: 6 };

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("parseMoneyValue", () => {
  it("handles null, undefined, and empty string as empty", () => {
    expect(parseMoneyValue(null)).toEqual({
      valid: true,
      value: null,
      isZero: false,
      isNegative: false,
      isPositive: false,
    });
    expect(parseMoneyValue(undefined).value).toBeNull();
    expect(parseMoneyValue("").value).toBeNull();
  });

  it("handles zero values as isZero", () => {
    expect(parseMoneyValue(0n).isZero).toBe(true);
    expect(parseMoneyValue("0").isZero).toBe(true);
    expect(parseMoneyValue(0).isZero).toBe(true);
    expect(parseMoneyValue("-0").isZero).toBe(true);
    expect(parseMoneyValue("+0").isZero).toBe(true);
  });

  it("identifies negative values", () => {
    const res = parseMoneyValue(-5000000n);
    expect(res.isNegative).toBe(true);
    expect(res.isPositive).toBe(false);
    expect(res.isZero).toBe(false);
    expect(res.value).toBe(-5000000n);

    expect(parseMoneyValue("-100").isNegative).toBe(true);
  });

  it("identifies positive values", () => {
    const res = parseMoneyValue(10000000n);
    expect(res.isPositive).toBe(true);
    expect(res.isNegative).toBe(false);
    expect(res.isZero).toBe(false);
    expect(res.value).toBe(10000000n);

    expect(parseMoneyValue("+100").isPositive).toBe(true);
  });

  it("detects invalid / non-numeric amounts", () => {
    expect(parseMoneyValue("abc").valid).toBe(false);
    expect(parseMoneyValue("12.34.56").valid).toBe(false);
    expect(parseMoneyValue(Number.NaN).valid).toBe(false);
    expect(parseMoneyValue(1.5).valid).toBe(false);
    expect(parseMoneyValue(Number.MAX_SAFE_INTEGER + 1).valid).toBe(false);
  });
});

describe("Money component", () => {
  describe("Zero amounts", () => {
    it("renders zero cleanly without negative sign or colored tone", () => {
      renderWithI18n(<Money amount={0n} meta={XLM} />);
      const el = screen.getByTestId("money-amount");
      expect(el.textContent).toBe("0 XLM");
      expect(el.getAttribute("aria-label")).toBe("0 XLM");
      // Must not carry danger or accent classes
      expect(el.className).not.toContain("text-danger");
      expect(el.className).not.toContain("text-accent");
    });

    it("renders string '0' and '-0' without minus sign", () => {
      const { rerender } = renderWithI18n(<Money amount="0" meta={XLM} />);
      expect(screen.getByTestId("money-amount").textContent).toBe("0 XLM");

      rerender(
        <I18nProvider>
          <Money amount="-0" meta={XLM} />
        </I18nProvider>,
      );
      expect(screen.getByTestId("money-amount").textContent).toBe("0 XLM");
    });
  });

  describe("Negative amounts and refunds", () => {
    it("renders negative amount with minus sign, theme danger tone, and accessible label", () => {
      renderWithI18n(<Money amount={-15000000n} meta={XLM} />);
      const el = screen.getByTestId("money-amount");
      expect(el.textContent).toBe("−1.5 XLM");
      expect(el.getAttribute("aria-label")).toBe("minus 1.5 XLM");
      expect(el.className).toContain("text-danger");
    });

    it("renders explicit refund with badge, danger tone, and refund announcement", () => {
      renderWithI18n(<Money amount={-25000000n} meta={XLM} isRefund />);
      const el = screen.getByTestId("money-amount");
      expect(el.textContent).toContain("Refund");
      expect(el.textContent).toContain("2.5 XLM");
      expect(el.getAttribute("aria-label")).toBe("Refund: -2.5 XLM");
      expect(el.className).toContain("text-danger");
    });

    it("renders refund with tone='refund' even if amount is unsigned/positive", () => {
      renderWithI18n(<Money amount={10000000n} meta={XLM} tone="refund" isRefund />);
      const el = screen.getByTestId("money-amount");
      expect(el.className).toContain("text-danger");
      expect(el.getAttribute("aria-label")).toContain("Refund");
    });

    it("hides sign when signDisplay is 'never' even if negative", () => {
      renderWithI18n(<Money amount={-10000000n} meta={XLM} signDisplay="never" />);
      const el = screen.getByTestId("money-amount");
      expect(el.textContent).toBe("1 XLM");
    });
  });

  describe("Positive amounts and sign displays", () => {
    it("renders positive amount without plus sign by default", () => {
      renderWithI18n(<Money amount={20000000n} meta={XLM} />);
      const el = screen.getByTestId("money-amount");
      expect(el.textContent).toBe("2 XLM");
      expect(el.getAttribute("aria-label")).toBe("2 XLM");
    });

    it("renders explicit plus sign and accent tone when signDisplay is 'always'", () => {
      renderWithI18n(<Money amount={20000000n} meta={XLM} signDisplay="always" />);
      const el = screen.getByTestId("money-amount");
      expect(el.textContent).toBe("+2 XLM");
      expect(el.className).toContain("text-accent");
      expect(el.getAttribute("aria-label")).toBe("+2 XLM");
    });
  });

  describe("Loading state", () => {
    it("renders loading skeleton with status role and aria-busy", () => {
      renderWithI18n(<Money amount={null} loading />);
      const el = screen.getByTestId("money-loading");
      expect(el).toBeDefined();
      expect(el.getAttribute("role")).toBe("status");
      expect(el.getAttribute("aria-busy")).toBe("true");
    });
  });

  describe("Empty state", () => {
    it("renders fallback when amount is null and not loading", () => {
      renderWithI18n(<Money amount={null} />);
      const el = screen.getByTestId("money-empty");
      expect(el.textContent).toBe("—");
    });

    it("renders custom empty fallback when provided", () => {
      renderWithI18n(<Money amount={undefined} emptyFallback="No balance" />);
      const el = screen.getByTestId("money-empty");
      expect(el.textContent).toBe("No balance");
    });
  });

  describe("Error state", () => {
    it("renders error state gracefully when amount string is invalid without throwing", () => {
      renderWithI18n(<Money amount="invalid-number" />);
      const el = screen.getByTestId("money-error");
      expect(el).toBeDefined();
      expect(el.getAttribute("role")).toBe("alert");
      expect(el.className).toContain("text-danger");
      expect(el.textContent).toContain("Invalid amount");
    });
  });

  describe("Token metadata and options", () => {
    it("supports 6-decimal USDC token", () => {
      renderWithI18n(<Money amount={1500000n} meta={USDC} />);
      const el = screen.getByTestId("money-amount");
      expect(el.textContent).toBe("1.5 USDC");
    });

    it("preserves the token's full precision unless a display limit is requested", () => {
      const { rerender } = renderWithI18n(<Money amount={12399999n} meta={XLM} />);
      expect(screen.getByTestId("money-amount").textContent).toBe("1.2399999 XLM");

      rerender(
        <I18nProvider>
          <Money amount={12399999n} meta={XLM} digits={2} />
        </I18nProvider>,
      );
      expect(screen.getByTestId("money-amount").textContent).toBe("1.23 XLM");
    });

    it("localizes the decimal separator and grouping for French", async () => {
      window.localStorage.setItem("payflow.locale", "fr");
      renderWithI18n(<Money amount={12345678000n} meta={XLM} />);

      await waitFor(() => {
        expect(screen.getByTestId("money-amount").textContent).toBe("1 234,5678 XLM");
      });
    });

    it("can hide symbol when showSymbol is false", () => {
      renderWithI18n(<Money amount={10000000n} meta={XLM} showSymbol={false} />);
      const el = screen.getByTestId("money-amount");
      expect(el.textContent).toBe("1");
    });
  });
});
