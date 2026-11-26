import { fromStroops, XLM, type TokenMeta } from "@/lib/format";
export type Locale = "en" | "fr" | "de" | "ar";

/**
 * Financial values use Latin digits in every locale: a stroop is a stroop, and
 * mixing Arabic-Indic digits into an amount a merchant will type back into a
 * form invites transcription mistakes. All the other locale choices — grouping,
 * decimal mark, month names, currency symbol placement, plural rules — still
 * come from Intl.
 */
export const localeTag = (locale: Locale) =>
  locale === "fr" ? "fr-FR" : locale === "de" ? "de-DE" : locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
export const isRtlLocale = (locale: Locale) => locale === "ar";
export const direction = (locale: Locale): "ltr" | "rtl" => isRtlLocale(locale) ? "rtl" : "ltr";

export function formatNumber(value: number | bigint, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale)).format(value);
}

/** The decimal mark the locale uses, read from Intl rather than hard-coded. */
export function decimalSeparator(locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale)).formatToParts(1.1).find(part => part.type === "decimal")?.value ?? ".";
}

/** Format an exact canonical decimal string without ever coercing it to Number. */
function formatDecimal(canonical: string, locale: Locale): string {
  const [, sign = "", whole = "0", fraction] = /^(-?)(\d+)(?:\.(\d+))?$/.exec(canonical) ?? [];
  return `${sign}${formatNumber(BigInt(whole), locale)}${fraction ? decimalSeparator(locale) + fraction : ""}`;
}

/** Group the integer bigint and retain the decimal string; never coerce money to Number. */
export function formatAmount(raw: string | bigint, locale: Locale, meta: TokenMeta = XLM, digits = 4): string {
  const canonical = fromStroops(raw, digits, meta.decimals);
  return `${formatDecimal(canonical, locale)} ${meta.symbol}`;
}

/**
 * A fiat amount from exact minor units, laid out by Intl's currency formatter.
 * Intl cannot accept a decimal string, so its parts are filled from the exact
 * bigint digits instead of losing cents to a Number conversion.
 */
export function formatCurrencyValue(
  minor: string | bigint,
  currency: string,
  locale: Locale,
  decimals = 2,
): string {
  const canonical = fromStroops(minor, decimals, decimals);
  const [, sign = "", whole = "0", fraction = ""] = /^(-?)(\d+)(?:\.(\d+))?$/.exec(canonical) ?? [];
  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(localeTag(locale), {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    // SEP-41 symbols such as XLM are not ISO 4217 codes; keep the exact value.
    return `${formatDecimal(canonical, locale)} ${currency}`;
  }
  const parts = formatter.formatToParts(0);
  const symbol = parts.find(part => part.type === "currency")?.value ?? currency;
  const decimal = parts.find(part => part.type === "decimal")?.value ?? ".";
  const formattedWhole = formatNumber(BigInt(whole), locale);
  return sign + parts.map(part => {
    switch (part.type) {
      case "integer": return formattedWhole;
      case "group": return "";
      case "decimal": return decimal;
      case "fraction": return fraction;
      case "currency": return symbol;
      case "minusSign": case "plusSign": return "";
      default: return part.value;
    }
  }).join("");
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
  if (minutes < 1) {
    if (locale === "fr") return delta >= 0 ? "échéance immédiate" : "à l’instant";
    if (locale === "de") return delta >= 0 ? "sofort fällig" : "gerade eben";
    if (locale === "ar") return delta >= 0 ? "الاستحقاق الآن" : "الآن";
    return delta >= 0 ? "due now" : "just now";
  }
  const hours = Math.round(minutes / 60);
  const [count, unit] = relativeUnit(minutes, hours);
  return new Intl.RelativeTimeFormat(localeTag(locale), { numeric: "always" }).format(delta < 0 ? -count : count, unit);
}
/** [seconds, English, French singular, French plural, dual, French feminine]. */
const PERIODS: Record<Locale, ReadonlyArray<readonly [number, string, string, string, string, boolean]>> = {
  en: [
    [31_536_000, "year", "years", "years", "year", false], [2_592_000, "month", "months", "months", "month", false],
    [604_800, "week", "weeks", "weeks", "week", false], [86_400, "day", "days", "days", "day", false],
    [3_600, "hour", "hours", "hours", "hour", false], [60, "minute", "minutes", "minutes", "minute", false],
    [1, "second", "seconds", "seconds", "second", false],
  ],
  fr: [
    [31_536_000, "year", "an", "ans", "an", false], [2_592_000, "month", "mois", "mois", "mois", false],
    [604_800, "week", "semaine", "semaines", "semaine", true], [86_400, "day", "jour", "jours", "jour", false],
    [3_600, "hour", "heure", "heures", "heure", true], [60, "minute", "minutes", "minutes", "minute", true],
    [1, "second", "seconde", "secondes", "seconde", true],
  ],
  de: [
    [31_536_000, "year", "Jahr", "Jahre", "Jahr", false], [2_592_000, "month", "Monat", "Monate", "Monat", false],
    [604_800, "week", "Woche", "Wochen", "Woche", true], [86_400, "day", "Tag", "Tage", "Tag", false],
    [3_600, "hour", "Stunde", "Stunden", "Stunde", true], [60, "minute", "Minute", "Minuten", "Minute", true],
    [1, "second", "Sekunde", "Sekunden", "Sekunde", true],
  ],
  ar: [
    [31_536_000, "year", "سنة", "سنوات", "سنتين", false], [2_592_000, "month", "شهر", "أشهر", "شهرين", false],
    [604_800, "week", "أسبوع", "أسابيع", "أسبوعين", true], [86_400, "day", "يوم", "أيام", "يومين", false],
    [3_600, "hour", "ساعة", "ساعات", "ساعتين", true], [60, "minute", "دقيقة", "دقائق", "دقيقتين", true],
    [1, "second", "ثانية", "ثوان", "ثانيتين", true],
  ],
};

export function formatPeriod(seconds: number, locale: Locale): string {
  for (const [size, en, singular, plural, dual, feminine] of PERIODS[locale]) {
    if (seconds < size || seconds % size !== 0) continue;
    const count = Math.round(seconds / size);
    if (locale === "fr") {
      return count === 1
        ? `par ${singular}`
        : `${feminine ? "toutes" : "tous"} les ${formatNumber(count, locale)} ${plural}`;
    }
    if (locale === "de") {
      return count === 1 ? `pro ${singular}` : `alle ${formatNumber(count, locale)} ${plural}`;
    }
    if (locale === "ar") {
      if (count === 1) return `كل ${singular}`;
      if (count === 2) return `كل ${dual}`;
      return `كل ${formatNumber(count, locale)} ${plural}`;
    }
    return count === 1 && size !== 1
      ? `per ${en}`
      : size === 1
        ? `every ${count}s`
        : `every ${formatNumber(count, locale)} ${en}s`;
  }
  return locale === "fr" ? `toutes les ${formatNumber(seconds, locale)} secondes`
    : locale === "de" ? `alle ${formatNumber(seconds, locale)} Sekunden`
    : locale === "ar" ? `كل ${formatNumber(seconds, locale)} ثانية`
    : `every ${seconds}s`;
}
export function formatFeeBps(bps: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale), { style: "percent", maximumFractionDigits: 2 }).format(Number.isFinite(bps) && bps > 0 ? bps / 10_000 : 0);
}

/** Localize the exact decimal output of the existing bigint oracle estimator. */
export function formatUsdString(value: string, locale: Locale): string {
  if (locale === "en") return value;
  const match = /^(< )?\$(\d+)\.(\d{2})$/.exec(value);
  if (!match) return value;
  const cents = BigInt(match[2]!) * 100n + BigInt(match[3]!);
  return `${match[1] ?? ""}${formatCurrencyValue(cents, "USD", locale, 2)}`;
}
export function formatTokenValue(raw: string | bigint, locale: Locale, digits = 4, decimals = 7): string {
  return formatAmount(raw, locale, { symbol: "", decimals }, digits).trimEnd();
}
