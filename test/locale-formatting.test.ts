import { describe, expect, it } from "vitest";
import {
  decimalSeparator,
  direction,
  formatAmount,
  formatCurrencyValue,
  formatDate,
  formatExactTime,
  formatFeeBps,
  formatNumber,
  formatPeriod,
  formatUsdString,
  isRtlLocale,
  localeTag,
} from "@/i18n/format";
import { createTranslation, translateMessage } from "@/i18n/translate";
import { parseAmount } from "@/lib/format";

const instant = Date.UTC(2026, 0, 2, 0, 5) / 1000;

describe("Intl-backed locale presentation (#333)", () => {
  it("maps locales to Intl tags and document directions", () => {
    expect(localeTag("en")).toBe("en-GB");
    expect(localeTag("fr")).toBe("fr-FR");
    expect(localeTag("ar")).toBe("ar-EG-u-nu-latn");
    expect(isRtlLocale("ar")).toBe(true);
    expect(direction("ar")).toBe("rtl");
    expect(direction("en")).toBe("ltr");
    expect(direction("fr")).toBe("ltr");
  });

  it("groups with Intl but keeps Latin digits in every financial locale", () => {
    expect(formatNumber(9007199254740993n, "ar")).toBe("9,007,199,254,740,993");
    expect(formatNumber(9007199254740993n, "fr")).toBe("9\u202f007\u202f199\u202f254\u202f740\u202f993");
    expect(decimalSeparator("fr")).toBe(",");
  });

  it("respects each token's own decimals without losing bigint precision", () => {
    expect(formatAmount(1_250_000n, "en", { symbol: "XLM", decimals: 7 }, 7)).toBe("0.125 XLM");
    expect(formatAmount(1_250_000n, "en", { symbol: "USDC", decimals: 6 }, 6)).toBe("1.25 USDC");
    expect(formatAmount(1_250_000n, "ar", { symbol: "USDC", decimals: 6 }, 6)).toBe("1.25 USDC");
    expect(formatAmount(90071992547409931n, "ar", undefined, 7)).toBe("9,007,199,254.7409931 XLM");
  });

  it("lays out fiat currency with Intl while filling it from exact minor units", () => {
    expect(formatCurrencyValue(1n, "USD", "en", 2)).toBe("US$0.01");
    expect(formatCurrencyValue(1n, "USD", "fr", 2)).toBe("0,01\u00a0$US");
    expect(formatCurrencyValue(123456n, "USD", "ar", 2)).toContain("1,234.56");
    expect(formatUsdString("< $0.01", "ar")).toContain("0.01");
  });

  it("localizes dates, relative time, periods and fees through Intl", () => {
    expect(formatDate(instant, "fr")).toBe("2 janv. 2026");
    expect(formatDate(instant, "ar")).toContain("2026");
    expect(formatExactTime(instant, "ar")).toContain("UTC");
    expect(formatPeriod(604_800 * 2, "ar")).toBe("كل أسبوعين");
    expect(formatPeriod(86_400 * 3, "ar")).toBe("كل 3 أيام");
    expect(formatFeeBps(1250, "en")).toBe("12.5%");
  });

  it("accepts Latin-digit Arabic amount entry with the same dot decimal as English", () => {
    expect(parseAmount("1.5", 7, localeTag("ar"))).toBe(15_000_000n);
    expect(parseAmount("1,234", 7, localeTag("ar"))).toBe(12_340_000_000n);
  });

  it("uses the Arabic catalog where present and falls back to English elsewhere", () => {
    const t = createTranslation("ar");
    expect(t("Retry")).toBe("إعادة المحاولة");
    expect(t("Language")).toBe("اللغة");
    expect(t("unregistered external text")).toBe("unregistered external text");
    expect(translateMessage("ar", "unregistered generated error")).toBe("unregistered generated error");
  });
});
