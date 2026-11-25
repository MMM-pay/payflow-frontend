import de from "./de.json";
import en from "./en.json";
import fr from "./fr.json";
import ar from "./ar.json";
import { formatNumber, type Locale } from "./format";
export type Translation = (key: string, values?: Record<string, unknown>) => string;
const english = en as Record<string, string>;
const catalogs: Record<Locale, Record<string, string>> = {
  en: english,
  fr: fr as Record<string, string>,
  de: de as Record<string, string>,
  ar: ar as Record<string, string>,
};
/** English is the fallback while a catalogue is still being translated. */
function catalogFor(locale: Locale): Record<string, string> {
  return locale === "en" ? english : { ...english, ...catalogs[locale] };
}
export function createTranslation(locale: Locale): Translation {
  const catalog = catalogFor(locale);
  return (key, values = {}) => (catalog[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!(name in values)) return match;
    const value = values[name];
    return typeof value === "number" || typeof value === "bigint" ? formatNumber(value, locale) : String(value ?? "");
  });
}
/** Only for application-generated labels/errors, never user-authored names or content. */
export function translateMessage(locale: Locale, message: string): string {
  const t = createTranslation(locale);
  const catalog = catalogFor(locale);
  if (message in catalog || locale === "en") return t(message);
  for (const key of Object.keys(english)) {
    if (!/\{\w+\}/.test(key)) continue;
    const names: string[] = [];
    const pattern = key.split(/(\{\w+\})/).map(part => {
      if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return "(.+?)"; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    const match = new RegExp(`^${pattern}$`).exec(message);
    if (match) return t(key, Object.fromEntries(names.map((name, index) => {
      const value = match[index + 1]!;
      return [name, value in catalog ? t(value) : /^\d+$/.test(value) ? BigInt(value) : value];
    })));
  }
  return message;
}
