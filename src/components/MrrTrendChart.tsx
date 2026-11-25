"use client";

import { useI18n } from "@/i18n/provider";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { Empty, Notice, SkeletonRows } from "@/components/ui";
import type { ApiMandate } from "@/lib/api";
import type { TokenMeta } from "@/lib/format";
import { toPolyline } from "@/lib/revenue";
import { buildMrrTrend, mrrChange, scaleMrrSeries } from "@/lib/mrr";

/**
 * Committed MRR over the last months, drawn with plain SVG.
 *
 * The point value a merchant already sees answers "what am I billing now"; a
 * line answers "is it growing". The series is rebuilt from mandate terms in
 * `lib/mrr`, so the component's job is only to draw it, and to be honest about
 * the states: loading, unreadable mandate data, and no commitments at all are
 * three different messages.
 *
 * Accessibility follows `RevenueChart`: the `svg` carries a summary as its
 * accessible name and the same figures are available as a real table behind a
 * disclosure. Colours come from the accent/edge tokens so the chart follows
 * the theme instead of hardcoding a palette.
 */

const WIDTH = 640;
const HEIGHT = 180;
const PADDING = 6;

function changeLabel(
  tr: (key: string, values?: Record<string, unknown>) => string,
  render: (value: bigint) => string,
  delta: bigint,
  percent: number | null,
): string {
  if (delta === 0n) return tr("No change");
  const amount = render(delta < 0n ? -delta : delta);
  const signed = percent === null ? 0 : Math.abs(percent);
  return delta > 0n
    ? tr("Up {0} ({1}%)", { 0: amount, 1: signed })
    : tr("Down {0} ({1}%)", { 0: amount, 1: signed });
}

export function MrrTrendChart({
  mandates,
  meta,
  now,
}: {
  mandates: ApiMandate[] | null;
  meta: TokenMeta;
  now?: number;
}) {
  const {
    t: tr,
    formatAmount,
    formatMonthLabel,
    describeMrrTrend,
  } = useI18n();
  const reducedMotion = useReducedMotion();
  const trend = mandates === null ? null : buildMrrTrend(mandates, now);
  const render = (value: bigint) => formatAmount(value, meta);

  if (mandates === null) {
    return <SkeletonRows rows={2} label="Loading committed MRR" />;
  }

  if (trend === null) {
    return (
      <Notice tone="error">
        {tr(
          "Committed MRR could not be read from these subscriptions — an amount or billing period is missing.",
        )}
      </Notice>
    );
  }

  const { points, estimated } = trend;
  const latest = points[points.length - 1];
  const hasCommitment = points.some((point) => point.mrr > 0n);

  if (!latest || !hasCommitment) {
    return (
      <Empty title={tr("No committed MRR yet")}>
        {tr(
          "A subscription adds its monthly-normalised amount here as soon as it starts.",
        )}
      </Empty>
    );
  }

  const previous = points[points.length - 2];
  const change = previous ? mrrChange(latest.mrr, previous.mrr) : null;
  const scaled = scaleMrrSeries(points, WIDTH, HEIGHT, PADDING);
  const summary = describeMrrTrend(points, render);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">{tr("Committed this month")}</div>
          <div className="text-2xl font-semibold tabular-nums">
            {render(latest.mrr)}
          </div>
        </div>
        {change && previous && (
          <div className="text-sm tabular-nums text-muted">
            <span className="sr-only">{tr("vs last month")}: </span>
            {changeLabel(tr, render, change.delta, change.percent)}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={`h-44 w-full ${reducedMotion ? "transition-none" : ""}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={summary}
      >
        <line
          x1={0}
          x2={WIDTH}
          y1={HEIGHT - PADDING}
          y2={HEIGHT - PADDING}
          className="stroke-edge"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={toPolyline(scaled)}
          fill="none"
          className={`stroke-accent ${reducedMotion ? "transition-none" : "transition-[stroke] duration-200"}`}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {scaled.map((point, index) => (
          <circle
            key={points[index]!.start}
            cx={point.x}
            cy={point.y}
            r={2.5}
            className="fill-accent"
          />
        ))}
      </svg>

      <div className="flex justify-between text-xs text-muted" aria-hidden="true">
        {points.map((point) => (
          <span key={point.start}>{formatMonthLabel(point.start)}</span>
        ))}
      </div>

      {estimated && (
        <p className="text-xs text-muted">
          {tr(
            "Estimated from mandate charge history: a subscription appears from the month its first charge implies, and disappears after it ends.",
          )}
        </p>
      )}

      <details className="text-sm">
        <summary
          className={`cursor-pointer text-muted hover:text-fg ${reducedMotion ? "transition-none" : "transition-colors"}`}
        >
          {tr("Show committed MRR as a table")}
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{summary}</caption>
            <thead>
              <tr className="border-b border-edge text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  {tr("Month")}
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                  {tr("Committed")}
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  {tr("Change")}
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {points.map((point, index) => {
                const before = points[index - 1];
                const step = before
                  ? changeLabel(
                      tr,
                      render,
                      mrrChange(point.mrr, before.mrr).delta,
                      mrrChange(point.mrr, before.mrr).percent,
                    )
                  : "—";
                return (
                  <tr key={point.start} className="border-b border-edge/60 last:border-0">
                    <th scope="row" className="py-1.5 pr-3 font-normal">
                      {formatMonthLabel(point.start)}
                    </th>
                    <td className="py-1.5 pr-3 text-right">{render(point.mrr)}</td>
                    <td className="py-1.5 text-right text-muted">{step}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

