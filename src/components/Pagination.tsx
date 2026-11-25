"use client";

import { useI18n } from "@/i18n/provider";

export function Pagination({
  cursor,
  limit,
  total,
  onCursorChange,
  loading = false,
}: {
  /** Zero-based offset, matching the API's `start`/`limit` convention. */
  cursor: number;
  limit: number;
  total: number;
  onCursorChange: (cursor: number) => void;
  loading?: boolean;
}) {
  const { t: tr } = useI18n();
  if (total <= limit || limit < 1) return null;

  const lastCursor = Math.floor((total - 1) / limit) * limit;
  const start = Math.min(Math.max(0, cursor), lastCursor);
  const end = Math.min(start + limit, total);

  return (
    <nav
      aria-label={tr("Table pagination")}
      className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p aria-live="polite" aria-atomic="true" className="text-muted">
        {tr("Showing {0}–{1} of {2}", {
          "0": start + 1,
          "1": end,
          "2": total,
        })}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-ghost min-h-11"
          disabled={loading || start === 0}
          onClick={() => onCursorChange(Math.max(0, start - limit))}
        >
          {tr("Previous page")}
        </button>
        <button
          type="button"
          className="btn-ghost min-h-11"
          disabled={loading || end >= total}
          onClick={() => onCursorChange(Math.min(lastCursor, start + limit))}
        >
          {tr("Next page")}
        </button>
      </div>
    </nav>
  );
}
