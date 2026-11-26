"use client";

import { TimeAgo } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { graceState } from "@/lib/grace";

/**
 * Badges a past-due mandate's grace period so the subscriber acts before it
 * ends: "Grace period ends in 3 days", switching to the danger tone in the
 * last day, and "Grace period ended 2 hours ago" once it has passed. The
 * wording carries the state, so it never relies on colour alone, and the
 * exact end time is in the tooltip.
 *
 * Renders nothing when the contract does not report a grace period (an older
 * contract, or a mandate that is not past due).
 */
export function GracePeriodBadge({ until, now }: { until: number | null; now?: number | undefined }) {
  const { t: tr } = useI18n();
  const state = graceState(until, now);
  if (state.kind === "none") return null;
  const tone =
    state.kind === "ended" || state.urgent
      ? "border-danger/40 bg-danger/15 text-danger"
      : "border-warn/40 bg-warn/15 text-warn";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}
      data-grace={state.kind === "open" && state.urgent ? "urgent" : state.kind}
    >
      {state.kind === "ended" ? tr("Grace period ended") : tr("Grace period ends")}{" "}
      <TimeAgo value={state.until} now={now} />
    </span>
  );
}
