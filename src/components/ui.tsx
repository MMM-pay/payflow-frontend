"use client";

import type { ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import { explorerBase } from "@/lib/config";
import { formatExactTime, formatWhen, shortAddress } from "@/lib/format";
import { useOrgName } from "@/lib/toml";

export function Panel({
  id,
  title,
  subtitle,
  children,
  actions,
}: {
  /** Optional DOM id, e.g. an anchor target for in-page links. */
  id?: string;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="panel" id={id}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="panel" aria-busy={loading || undefined}>
      <div className="label">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">
        {loading ? <Skeleton className="h-8 w-24" /> : value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/**
 * Decorative loading block. `motion-safe` means the pulse is dropped entirely
 * for users who ask their OS to reduce motion.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded bg-fg/10 motion-safe:animate-pulse ${className}`}
    />
  );
}

/** Placeholder rows matching the mandate-style cards used on account and merchant. */
export function SkeletonRows({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-lg border border-edge p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="w-full space-y-1.5 sm:w-auto">
              <Skeleton className="h-5 w-44 max-w-full" />
              <Skeleton className="h-5 w-64 max-w-full" />
              <Skeleton className="h-4 w-40 max-w-full" />
            </div>
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder grid matching the plan cards on the subscribe page. */
export function SkeletonPlanCards({ cards = 4, label = "Loading plans" }: { cards?: number; label?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2" role="status" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="panel">
          <div className="mb-4">
            <Skeleton className="h-6 w-32" />
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-5 w-24" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-28" />
            </div>
            <div>
              <Skeleton className="mb-1.5 h-3 w-40" />
              <Skeleton className="h-[38px] w-full rounded-lg" />
            </div>
            <Skeleton className="h-[38px] w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  Active: "bg-accent/15 text-accent",
  Paused: "bg-warn/15 text-warn",
  Cancelled: "bg-danger/15 text-danger",
  Completed: "bg-info/15 text-info",
};

export function Badge({ status }: { status: string }) {
  const tone = BADGE_TONES[status] ?? "bg-fg/10 text-soft";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>
  );
}

export function AddressLink({ value, kind = "account" }: { value: string; kind?: "account" | "contract" }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 align-middle">
      <a
        href={`${explorerBase}/${kind}/${value}`}
        target="_blank"
        rel="noreferrer"
        className="mono truncate text-muted underline-offset-2 hover:text-accent hover:underline"
        title={value}
      >
        {shortAddress(value, 6)}
      </a>
      <CopyButton value={value} label={kind === "contract" ? "contract address" : "address"} />
    </span>
  );
}

/**
 * A timestamp as relative text ("in 3 days") with the exact local time in the
 * tooltip — and, unlike a bare `title`, in text a screen reader reads out too.
 */
export function TimeAgo({ value }: { value: number }) {
  if (!value) return <span className="text-muted">—</span>;
  const exact = formatExactTime(value);
  return (
    <time dateTime={new Date(value * 1000).toISOString()} title={exact}>
      {formatWhen(value)}
      <span className="sr-only"> ({exact})</span>
    </time>
  );
}

/**
 * A merchant's address alongside the name they publish in their stellar.toml.
 * The name is self-declared — the protocol cannot verify it — so that is said
 * out loud in the tooltip and to screen readers, never implied to be vetted.
 * When no name resolves, this is just the address, exactly as before.
 */
export function MerchantAccount({ value }: { value: string }) {
  const name = useOrgName(value);
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 align-middle">
      {name && (
        <span
          className="max-w-full truncate font-medium"
          title="Self-declared by the merchant in their stellar.toml"
        >
          {name}
          <span className="sr-only"> (self-declared merchant name)</span>
        </span>
      )}
      <AddressLink value={value} />
    </span>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 align-middle">
      <a
        href={`${explorerBase}/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        className="mono truncate text-muted underline-offset-2 hover:text-accent hover:underline"
      >
        {shortAddress(hash, 6)}
      </a>
      <CopyButton value={hash} label="transaction hash" />
    </span>
  );
}

export function Notice({ tone, children }: { tone: "error" | "ok" | "info"; children: ReactNode }) {
  const tones = {
    error: "border-danger/40 bg-danger/10 text-danger",
    ok: "border-accent/40 bg-accent/10 text-accent",
    info: "border-edge bg-fg/5 text-muted",
  } as const;
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>
  );
}

/**
 * An empty state that says what is missing, why, and what to do next.
 *
 * `title` names the situation, `children` explains it, and `action` offers the
 * next step — usually a `Link` or button. A title- and action-less usage
 * still works for transitional states like "Loading…".
 */
export function Empty({
  title,
  children,
  action,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-edge px-4 py-8 text-center">
      {title && <p className="text-sm font-medium text-slate-200">{title}</p>}
      <p className={`mx-auto max-w-prose text-sm text-muted ${title ? "mt-1" : ""}`}>
        {children}
      </p>
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}


export function NetworkMismatchBanner({
  walletNetwork,
  expectedNetwork,
}: {
  walletNetwork: string | null;
  expectedNetwork: string;
}) {
  if (!walletNetwork) return null;
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
      <div className="flex items-center gap-2">
        <span aria-hidden="true">⚠</span>
        <span>
          <strong>Network mismatch detected.</strong> Your wallet is connected to a different
          network than this app. Switch to{" "}
          <span className="font-mono text-xs">{expectedNetwork}</span> to interact with
          contracts. Contract write operations are disabled while mismatched.
        </span>
      </div>
    </div>
  );
}
