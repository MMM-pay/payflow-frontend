import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkAmount, parseAmount } from "@/lib/format";
import { formatAmount, formatDate, formatExactTime, formatPeriod, formatUsdString, formatWhen, numberFormatterFor } from "@/i18n/format";
import { createTranslation, translateMessage } from "@/i18n/translate";
import { presentation } from "@/i18n/presentation";
import de from "@/i18n/de.json";
import en from "@/i18n/en.json";
import fr from "@/i18n/fr.json";

describe("English and French financial presentation", () => {
  it("reuses number formatter instances per locale without sharing across locales", () => {
    expect(numberFormatterFor("en")).toBe(numberFormatterFor("en"));
    expect(numberFormatterFor("fr")).toBe(numberFormatterFor("fr"));
    expect(numberFormatterFor("en")).not.toBe(numberFormatterFor("fr"));
  });
  it("keeps adjacent stroops beyond Number.MAX_SAFE_INTEGER distinct", () => {
    expect(formatAmount(90071992547409931n, "fr", undefined, 7)).toBe("9\u202f007\u202f199\u202f254,7409931 XLM");
    expect(formatAmount(90071992547409932n, "fr", undefined, 7)).toBe("9\u202f007\u202f199\u202f254,7409932 XLM");
    expect(formatAmount(-1n, "fr", undefined, 7)).toBe("-0,0000001 XLM");
    expect(formatAmount(1234567n, "fr", { symbol: "USDC", decimals: 6 }, 6)).toBe("1,234567 USDC");
  });
  it("interprets a three-digit French fraction as a decimal, not thousands", () => {
    expect(parseAmount("1,234", 7, "fr-FR")).toBe(12340000n);
    expect(parseAmount("1,234", 7, "en-GB")).toBe(12340000000n);
    expect(parseAmount("1\u202f234,567891", 6, "fr-FR")).toBe(1234567891n);
    expect(parseAmount("1234.567891", 6, "fr-FR")).toBe(1234567891n);
    expect(checkAmount("1,2345678", 6, "fr-FR").ok).toBe(false);
    expect(checkAmount("1,2,3", 7, "fr-FR").ok).toBe(false);
    expect(checkAmount("0", 7, "fr-FR").ok).toBe(false);
  });
  it("uses locale dates with a fixed UTC day and exact time", () => {
    const instant = Date.UTC(2026, 0, 2, 0, 5) / 1000;
    expect(formatDate(instant, "en")).toBe("2 Jan 2026");
    expect(formatDate(instant, "fr")).toBe("2 janv. 2026");
    expect(formatExactTime(instant, "fr")).toContain("00:05");
    expect(formatWhen(instant + 86400, "fr", instant * 1000)).toBe("dans 1 jour");
    expect(formatPeriod(604800 * 2, "fr")).toBe("toutes les 2 semaines");
    expect(formatPeriod(86400, "fr")).toBe("par jour");
  });
  it("localizes the oracle estimator's exact cents without floating point", () => {
    expect(formatUsdString("$9007199254740993.01", "fr")).toBe("9\u202f007\u202f199\u202f254\u202f740\u202f993,01\u00a0$US");
    expect(formatUsdString("< $0.01", "fr")).toBe("< 0,01\u00a0$US");
  });
  it("localizes dynamic trial and discount text and accessible chart descriptions", () => {
    const p = presentation("fr");
    expect(p.trialBadge({ trial: 3 * 86400 })).toBe("Essai gratuit : 3\u00a0jours");
    expect(p.discountBadge({ discount_bps: 1250, discount_charges: 3 })).toBe("12,5\u00a0% de réduction sur 3 prélèvements");
    expect(p.describeSeries([], "day", String)).toBe("Aucun revenu enregistré sur cette période.");
    const date = Date.UTC(2026, 0, 2) / 1000;
    const description = p.describeSeries([{ start: date, net: 1n, gross: 2n, fee: 1n }], "day", value => formatAmount(value, "fr", undefined, 7));
    expect(description).toContain("2 janv. 2026");
    expect(description).toContain("0,0000001 XLM");
  });
});

describe("German financial presentation", () => {
  it("uses German separators, dates and relative times", () => {
    expect(formatAmount(123456789n, "de", undefined, 7)).toBe("12,3456789 XLM");
    expect(formatAmount(90071992547409931n, "de", undefined, 7)).toBe("9.007.199.254,7409931 XLM");
    const instant = Date.UTC(2026, 0, 2, 0, 5) / 1000;
    expect(formatDate(instant, "de")).toMatch(/^2\./);
    expect(formatDate(instant, "de")).toContain("2026");
    expect(formatExactTime(instant, "de")).toContain("00:05");
    expect(formatWhen(instant + 86400, "de", instant * 1000)).toBe("in 1 Tag");
    expect(formatWhen(instant + 20, "de", instant * 1000)).toBe("sofort fällig");
    expect(formatWhen(instant - 20, "de", instant * 1000)).toBe("gerade eben");
    expect(formatPeriod(604800 * 2, "de")).toBe("alle 2 Wochen");
    expect(formatPeriod(86400, "de")).toBe("pro Tag");
    expect(formatPeriod(3600, "de")).toBe("pro Stunde");
    expect(formatPeriod(2592000, "de")).toBe("pro Monat");
    expect(formatUsdString("$9007199254740993.01", "de")).toBe("9.007.199.254.740.993,01\u00a0$");
  });
  it("localizes trial, churn, MRR and validator text in German", () => {
    const p = presentation("de");
    expect(p.trialBadge({ trial: 3 * 86400 })).toBe("Kostenlose Testphase: 3 Tage");
    expect(p.describeSeries([], "day", String)).toBe("In diesem Zeitraum wurden keine Einnahmen verzeichnet.");
    expect(p.formatMonthLabel(Date.UTC(2026, 0, 1) / 1000)).toContain("2026");
    expect(p.describeMrrTrend([], String)).toBe("In diesem Zeitraum wurde keine gebundene MRR verzeichnet.");
    expect(createTranslation("de")("Plan #{0}", { 0: 1234 })).toBe("Angebot Nr. 1.234");
    expect(translateMessage("de", "At most 6 decimal places.")).toBe("Höchstens 6 Nachkommastellen.");
    expect(translateMessage("de", "That plan does not exist.")).toBe("Dieses Angebot existiert nicht.");
  });
});

describe("catalog completeness and application errors", () => {
  it("has French and German translations with matching interpolation tokens for every English key", () => {
    for (const [name, catalog] of [["French", fr], ["German", de]] as const) {
      const entries = catalog as Record<string, string>;
      expect(Object.keys(entries).sort(), name).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en)) {
        expect(entries[key]!.trim(), `${name}: ${key}`).not.toBe("");
        expect([...new Set([...entries[key]!.matchAll(/\{\w+\}/g)].map(m => m[0]))].sort(), `${name}: ${key}`).toEqual([...new Set([...key.matchAll(/\{\w+\}/g)].map(m => m[0]))].sort());
      }
    }
  });
  it("interpolates locale numbers, preserves external values, and falls back safely", () => {
    const t = createTranslation("fr");
    expect(t("Plan #{0}", { 0: 1234 })).toBe("Offre n° 1\u202f234");
    expect(t("unregistered external text")).toBe("unregistered external text");
    expect(t("{0} copied", { 0: "My English plan" })).toBe("My English plan copié");
    expect(translateMessage("fr", "At most 6 decimal places.")).toBe("Au maximum 6 décimales.");
    expect(translateMessage("fr", "Enter a whole number of weeks.")).toBe("Saisissez un nombre entier de semaines.");
    expect(translateMessage("fr", "Wallet account changed. Please retry the transaction with the new account.")).toContain("Le compte du portefeuille a changé");
  });

  it("covers every literal translation key referenced across src/", () => {
    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
      }
      return out;
    }
    const missing: string[] = [];
    const re = /\b(?:tr|t)\(\s*"((?:[^"\\]|\\.)*)"/g;
    for (const file of walk(path.join(process.cwd(), "src"))) {
      const source = fs.readFileSync(file, "utf8");
      for (let match = re.exec(source); match; match = re.exec(source)) {
        const key = JSON.parse(`"${match[1]}"`) as string;
        if (!(key in en) || !(key in fr)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
