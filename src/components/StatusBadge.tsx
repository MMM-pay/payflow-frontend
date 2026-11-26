"use client";

import { useI18n } from "@/i18n/provider";

/**
 * One badge for every mandate and plan state, so the same state always reads
 * and looks the same whether it appears on the merchant dashboard, the
 * subscribe page, or a mandate's detail card.
 *
 * The text label carries the meaning — colour is only a supporting cue — and
 * every colour is a theme token, so the badge keeps contrast in light and
 * dark themes. States the app does not recognise fall back to a neutral tone
 * and the raw value as its label instead of inventing something misleading.
 */
const STATUS_TONES: Record<string, string> = {
  Active: "bg-accent/15 text-accent",
  Paused: "bg-warn/15 text-warn",
  Cancelled: "bg-danger/15 text-danger",
  Completed: "bg-info/15 text-info",
};

export function StatusBadge({
  status,
  label,
}: {
  /** Raw mandate or plan state, e.g. "Active", "Paused", "Cancelled", "Completed". */
  status: string;
  /** Optional visible-text override. Defaults to the translated state. */
  label?: string;
}) {
  const { t: tr } = useI18n();
  const tone = STATUS_TONES[status] ?? "bg-fg/10 text-soft";
  const text = label !== undefined ? label : tr(status);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      {text}
    </span>
  );
}
