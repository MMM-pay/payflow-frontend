"use client";
import { isLocale, useI18n } from "./provider";
export function LanguagePicker() {
  const { locale, setLocale, t } = useI18n();
  return <label htmlFor="language-picker" className="flex items-center gap-2 text-sm text-muted">
    <span>{t("Language")}</span>
    <select id="language-picker" aria-label={t("Language")} className="input min-h-11 w-auto" value={locale}
      onChange={event => { if (isLocale(event.target.value)) setLocale(event.target.value); }}>
      <option value="en" lang="en" dir="ltr">English</option>
      <option value="fr" lang="fr" dir="ltr">Français</option>
      <option value="de" lang="de" dir="ltr">Deutsch</option>
      <option value="ar" lang="ar" dir="rtl">العربية</option>
    </select>
  </label>;
}
