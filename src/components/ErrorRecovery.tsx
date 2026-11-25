"use client";

import { useI18n } from "@/i18n/provider";

export function ErrorRecovery({
  detail,
  onReload,
  onRetry,
}: {
  detail?: string | null;
  onReload: () => void;
  onRetry: () => void;
}) {
  const { t: tr } = useI18n();

  return (
    <section
      role="alert"
      aria-labelledby="app-error-title"
      aria-describedby="app-error-description"
      className="panel mx-auto w-full max-w-2xl"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-danger">
        {tr("Something went wrong")}
      </p>
      <h1 id="app-error-title" className="mt-2 text-2xl font-semibold text-fg">
        {tr("We couldn't load this page.")}
      </h1>
      <p id="app-error-description" className="mt-2 max-w-prose text-sm text-muted">
        {tr("Your payment settings are safe. Try again, or reload the page.")}
      </p>
      {detail ? (
        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer text-soft">{tr("Technical details")}</summary>
          <p className="mono mt-2 break-words rounded-lg border border-edge bg-ink p-2 text-danger">
            {detail}
          </p>
        </details>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onRetry}>
          {tr("Try again")}
        </button>
        <button type="button" className="btn-ghost" onClick={onReload}>
          {tr("Reload page")}
        </button>
      </div>
    </section>
  );
}
