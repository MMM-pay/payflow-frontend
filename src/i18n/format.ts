import { fromStroops, XLM, type TokenMeta } from "@/lib/format";
export type Locale = "en" | "fr" | "de";
export const localeTag = (locale: Locale) =>
  locale === "fr" ? "fr-FR" : locale === "de" ? "de-DE" : "en-GB";
export function formatNumber(value: number | bigint, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale)).format(value);
}
/** Group the integer bigint and retain the decimal string; never coerce money to Number. */
export function formatAmount(raw: string | bigint, locale: Locale, meta: TokenMeta = XLM, digits = 4): string {
  const canonical = fromStroops(raw, digits, meta.decimals);
  const [, sign = "", whole = "0", fraction] = /^(-?)(\d+)(?:\.(\d+))?$/.exec(canonical) ?? [];
  const decimal = new Intl.NumberFormat(localeTag(locale)).formatToParts(1.1).find(part => part.type === "decimal")?.value ?? ".";
  return `${sign}${formatNumber(BigInt(whole), locale)}${fraction ? decimal + fraction : ""} ${meta.symbol}`;
}
export function formatDate(seconds: number, locale: Locale): string {
  if (!seconds) return "—";
  return new Intl.DateTimeFormat(localeTag(locale), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(seconds * 1000));
}
export function formatExactTime(seconds: number, locale: Locale): string {
  if (!seconds) return "—";
  return new Intl.DateTimeFormat(localeTag(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(seconds * 1000)) + " UTC";
}
/**
 * Picks the largest unit that reads naturally: "in 3 days", but "in 3 weeks",
 * "in 5 months" and "in 2 years" for a charge further out, rather than
 * "in 90 days". The exact date is always shown beside it.
 */
function relativeUnit(minutes: number, hours: number): [number, Intl.RelativeTimeFormatUnit] {
  if (minutes < 60) return [minutes, "minute"];
  if (hours < 24) return [hours, "hour"];
  const days = Math.round(hours / 24);
  // Up to a fortnight stays in days, so trial lengths such as "in 14 days"
  // read as they always have.
  if (days <= 14) return [days, "day"];
  if (days < 30) return [Math.round(days / 7), "week"];
  if (days < 365) return [Math.round(days / 30), "month"];
  return [Math.round(days / 365), "year"];
}
export function formatWhen(seconds: number, locale: Locale, now = Date.now()): string {
  if (!seconds) return "—";
  const delta = seconds * 1000 - now;
  const minutes = Math.round(Math.abs(delta) / 60_000);
  if (minutes < 1) return locale === "fr" ? (delta >= 0 ? "échéance immédiate" : "à l’instant") : locale === "de" ? (delta >= 0 ? "sofort fällig" : "gerade eben") : (delta >= 0 ? "due now" : "just now");
  const hours = Math.round(minutes / 60);
  const [count, unit] = relativeUnit(minutes, hours);
  return new Intl.RelativeTimeFormat(localeTag(locale), { numeric: "always" }).format(delta < 0 ? -count : count, unit);
}
export function formatPeriod(seconds: number, locale: Locale): string {
  const units = [
    [31_536_000, "year", "an", "ans", false], [2_592_000, "month", "mois", "mois", false],
    [604_800, "week", "semaine", "semaines", true], [86_400, "day", "jour", "jours", false],
    [3_600, "hour", "heure", "heures", true], [60, "minute", "minute", "minutes", true],
    [1, "second", "seconde", "secondes", true],
  ] as const;
  for (const [size, en, singular, plural, feminine] of units) {
    if (seconds >= size && seconds % size === 0) {
      const count = seconds / size;
      if (locale === "fr") return count === 1 ? `par ${singular}` : `${feminine ? "toutes" : "tous"} les ${formatNumber(count, locale)} ${plural}`;
      if (locale === "de") {
        const german = {
          year: ["Jahr", "Jahre"], month: ["Monat", "Monate"],
          week: ["Woche", "Wochen"], day: ["Tag", "Tage"],
          hour: ["Stunde", "Stunden"], minute: ["Minute", "Minuten"],
          second: ["Sekunde", "Sekunden"],
        } as const;
        const [one, many] = german[en];
        return count === 1 ? `pro ${one}` : `alle ${formatNumber(count, locale)} ${many}`;
      }
      return count === 1 && size !== 1 ? `per ${en}` : size === 1 ? `every ${count}s` : `every ${formatNumber(count, locale)} ${en}s`;
    }
  }
  return locale === "fr" ? `toutes les ${formatNumber(seconds, locale)} secondes` : `every ${seconds}s`;
}
export function formatFeeBps(bps: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale), { style: "percent", maximumFractionDigits: 2 }).format(Number.isFinite(bps) && bps > 0 ? bps / 10_000 : 0);
}

/** Localize the exact decimal output of the existing bigint oracle estimator. */
export function formatUsdString(value: string, locale: Locale): string {
  if (locale === "en") return value;
  const match = /^(< )?\$(\d+)\.(\d{2})$/.exec(value);
  if (!match) return value;
  const currency = locale === "de" ? "$" : "$US";
  return `${match[1] ?? ""}${formatNumber(BigInt(match[2]!), locale)},${match[3]}\u00a0${currency}`;
}
export function formatTokenValue(raw: string | bigint, locale: Locale, digits = 4, decimals = 7): string {
  return formatAmount(raw, locale, { symbol: "", decimals }, digits).trimEnd();
}
