"use client";

import { useI18n } from "@/i18n/provider";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import { explorerBase } from "@/lib/config";
import{ shortAddress } from "@/lib/format";
import { LABEL_MAX_LENGTH, saveLabel, useAddressLabel } from "@/lib/labels";
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
  const { t: tr } = useI18n();
  const titleId = useId();
  return (
    <section
      className="panel"
      id={id}
      // Naming the section after its heading lets screen-reader users jump
      // between the panels of a long page (a plan card, a form, a table)
      // instead of hearing one undifferentiated run of content.
      aria-labelledby={title ? titleId : undefined}
    >
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            {title && <h2 id={titleId} className="text-base font-semibold">{tr(title)}</h2>}
            {subtitle && <p className="mt-1 text-sm text-muted">{tr(subtitle)}</p>}
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
  const { t: tr, formatNumber } = useI18n();
  return (
    <div className="panel" aria-busy={loading || undefined}>
      <div className="label">{typeof label === "string" ? tr(label) : label}</div>
      <div className="text-2xl font-semibold tabular-nums">
        {loading ? <Skeleton className="h-8 w-24" /> : typeof value === "number" || typeof value === "bigint" ? formatNumber(value) : value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{typeof hint === "string" ? tr(hint) : hint}</div>}
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
  const { t: tr } = useI18n();
  return (
    <div className="space-y-3" role="status" aria-busy="true">
      <span className="sr-only">{typeof label === "string" ? tr(label) : label}…</span>
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

/**
 * Inline validation text for a form control.
 *
 * Forms used to spell this markup out by hand, which drifted in spacing,
 * translation and, most importantly, whether the message was announced. This
 * renders a single `role="alert"` paragraph and translates application
 * messages through the same catalog as the rest of the UI. Point the control's
 * `aria-describedby` at `id`; nothing is rendered when there is no message.
 */
export function InlineError({
  id,
  children,
  className = "mt-1",
}: {
  /** Id referenced by the control's `aria-describedby`. */
  id: string;
  children?: ReactNode;
  /** Spacing override; text size and danger tone are fixed. */
  className?: string;
}) {
  const { translateMessage } = useI18n();
  if (children === null || children === undefined || children === false || children === "") {
    return null;
  }
  return (
    <p id={id} role="alert" className={`${className} text-sm text-danger`}>
      {typeof children === "string" ? translateMessage(children) : children}
    </p>
  );
}

/**
 * Static help text under a form control.
 *
 * A hint is not an error: it stays visible alongside validation, uses the muted
 * token in both themes, and is translated like every other label. Pass
 * `live` when the hint is recomputed while the reader types (e.g. a summary of
 * what the entered amount covers) so assistive technology hears the update.
 */
export function FieldHint({
  id,
  children,
  className = "mt-1",
  live = false,
}: {
  /** Id referenced by the control's `aria-describedby`. */
  id: string;
  children?: ReactNode;
  /** Spacing override; text size and muted tone are fixed. */
  className?: string;
  /** Announce changes politely while the reader types. */
  live?: boolean;
}) {
  const { t: tr } = useI18n();
  if (children === null || children === undefined || children === false || children === "") {
    return null;
  }
  return (
    <p
      id={id}
      className={`${className} text-xs text-muted`}
      aria-live={live ? "polite" : undefined}
    >
      {typeof children === "string" ? tr(children) : children}
    </p>
  );
}

/** Placeholder grid matching the plan cards on the subscribe page. */
export function SkeletonPlanCards({ cards = 4, label = "Loading plans" }: { cards?: number; label?: string }) {
  const { t: tr } = useI18n();
  return (
    <div className="grid gap-4 sm:grid-cols-2" role="status" aria-busy="true">
      <span className="sr-only">{typeof label === "string" ? tr(label) : label}…</span>
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

/**
 * Placeholder matching the plan detail page: the plan summary panel, the
 * charge table and the subscribe form. Reserving those three blocks keeps the
 * page from jumping when the data arrives, which is what the loading state is
 * for (#304).
 */
export function SkeletonPlanDetail({ label = "Loading plan" }: { label?: string }) {
  const { t: tr } = useI18n();
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{typeof label === "string" ? tr(label) : label}…</span>
      <div aria-hidden="true" className="space-y-6">
        <div className="panel">
          <Skeleton className="h-6 w-40" />
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-32" />
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <Skeleton className="h-6 w-36" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        </div>
        <div className="panel">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-2 h-4 w-full max-w-prose" />
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Skeleton className="h-[38px] w-52 max-w-full rounded-lg" />
            <Skeleton className="h-[38px] w-28 rounded-lg" />
          </div>
        </div>
      </div>
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
  const { t: tr } = useI18n();
  const tone = BADGE_TONES[status] ?? "bg-fg/10 text-soft";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{tr(status)}</span>
  );
}

/**
 * An address with an optional label the reader gave it.
 *
 * The label lives only in this browser (see `lib/labels`), so it works with
 * no backend and is never shared. The pencil exposes a small inline form;
 * labels are edited in place rather than on a separate settings page so the
 * reader can name an address exactly where they were confused by it.
 */
export function AddressLink({
  value,
  kind = "account",
  base = explorerBase,
}: {
  value: string;
  kind?: "account" | "contract";
  /**
   * Explorer base to build the link from. Defaults to the network in force;
   * callers rendering network-dependent markup before hydration pass their
   * own so the first render matches the prerendered HTML.
   */
  base?: string;
}) {
  const { t: tr } = useI18n();
  const label = useAddressLabel(value);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [writeFailed, setWriteFailed] = useState(false);
  const noun = kind === "contract" ? tr("contract") : tr("address");

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEditing() {
    setDraft(label ?? "");
    setWriteFailed(false);
    setEditing(true);
  }

  function commit(raw: string) {
    const result = saveLabel(value, raw);
    if (!result.ok) {
      // Storage is blocked: keep the form open and say so rather than
      // silently discarding what was typed.
      setWriteFailed(true);
      return;
    }
    setWriteFailed(false);
    setEditing(false);
  }

  return (
    <span className="inline-flex max-w-full flex-col align-middle">
      <span className="inline-flex max-w-full flex-wrap items-center gap-1">
        {label && (
          <span className="max-w-full truncate font-medium" title={label}>
            {label}
            <span className="sr-only">
              {" "}
              {kind === "contract"
                ? tr("Your label for this contract")
                : tr("Your label for this address")}
            </span>
          </span>
        )}
        <a
          href={`${base}/${kind}/${value}`}
          target="_blank"
          rel="noreferrer"
          className="mono truncate text-muted underline-offset-2 hover:text-accent hover:underline"
          title={value}
        >
          {shortAddress(value, 6)}
        </a>
        <CopyButton value={value} label={kind === "contract" ?tr("contract address") :tr("address")} />
        <button
          type="button"
          onClick={startEditing}
          aria-expanded={editing}
          aria-label={
            label
              ? tr("Edit your label for {address}", { address: value })
              : tr("Add a label for {address}", { address: value })
          }
          title={label ? tr("Edit label") : tr("Add a label")}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition hover:bg-fg/10 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      </span>
      {editing && (
        <form
          className="mt-1 flex max-w-full flex-wrap items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            commit(draft);
          }}
        >
          <label className="sr-only" htmlFor={inputId}>
            {tr("Label for {address}", { address: value })}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            className="input h-8 w-40 max-w-full py-1 text-xs"
            value={draft}
            maxLength={LABEL_MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={tr("e.g. Alice")}
            autoComplete="off"
          />
          <button type="submit" className="btn-ghost px-2 py-1 text-xs">
            {tr("Save")}
          </button>
          {label && (
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => commit("")}
            >
              {tr("Remove")}
            </button>
          )}
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => {
              setEditing(false);
              setWriteFailed(false);
            }}
          >
            {tr("Cancel")}
          </button>
          {writeFailed && (
            <span role="status" className="text-xs text-danger">
              {tr("This browser is not allowing labels to be saved.")}
            </span>
          )}
        </form>
      )}
    </span>
  );
}

/**
 * A timestamp as relative text ("in 3 days") with the exact local time in the
 * tooltip — and, unlike a bare `title`, in text a screen reader reads out too.
 */
export function TimeAgo({ value }: { value: number }) {
  const { formatExactTime, formatWhen } = useI18n();
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
  const { t: tr } = useI18n();
  const name = useOrgName(value);
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 align-middle">
      {name && (
        <span
          className="max-w-full truncate font-medium"
          title={tr("Self-declared by the merchant in their stellar.toml")}
        >
          {name}
          <span className="sr-only">{" "}{tr("(self-declared merchant name)")}</span>
        </span>
      )}
      <AddressLink value={value} />
    </span>
  );
}

export function TxLink({ hash }: { hash: string }) {
  const { t: tr } = useI18n();
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
      <CopyButton value={hash} label={tr("transaction hash")} />
    </span>
  );
}

export function Notice({
  tone,
  children,
  role,
}: {
  tone: "error" | "ok" | "info" | "warn";
  children: ReactNode;
  /**
   * Use `alert` for a failure the user is waiting on (it is announced at
   * once) and `status` for a non-urgent update. Omitted, a notice is ordinary
   * content and is only read when reached by navigation.
   */
  role?: "alert" | "status";
}) {
  const { translateMessage } = useI18n();
  const tones = {
    error: "border-danger/40 bg-danger/10 text-danger",
    ok: "border-accent/40 bg-accent/10 text-accent",
    info: "border-edge bg-fg/5 text-muted",
    warn: "border-warn/40 bg-warn/10 text-warn",
  } as const;
  return (
    <div role={role} className={`rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>
      {typeof children === "string" ? translateMessage(children) : children}
    </div>
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
  const { t: tr } = useI18n();
  return (
    <div className="rounded-lg border border-dashed border-edge px-4 py-8 text-center">
      {title && <p className="text-sm font-medium text-slate-200">{tr(title)}</p>}
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
  const { t: tr } = useI18n();
  if (!walletNetwork) return null;
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
      <div className="flex items-center gap-2">
        <span aria-hidden="true">⚠</span>
        <span>
          <strong>{tr("Network mismatch detected.")}</strong>{" "}{tr("Your wallet is connected to a different network than this app. Switch to")}{" "}
          <span className="font-mono text-xs">{expectedNetwork}</span>{" "}{tr("to interact with contracts. Contract write operations are disabled while mismatched.")}</span>
      </div>
    </div>
  );
}

/** What Tab can reach inside a dialog. `disabled` controls and `tabindex="-1"`
 *  are not tabbable, so they must not be part of the ring either. */
const DIALOG_TABABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tabbableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(DIALOG_TABABLE)).filter(
    (el) => !el.closest('[hidden], [aria-hidden="true"], fieldset[disabled]'),
  );
}

/**
 * A modal dialog: focus moves in when it opens, cannot get out while it stays
 * open, Escape closes it, and focus returns to whatever opened it.
 *
 * Confirmations in this app are inline buttons or `window.confirm`, which
 * cannot be styled, labelled, or kept in reach on a phone — this is the
 * primitive they switch to. It holds no data of its own, so it behaves the
 * same with and without `NEXT_PUBLIC_API_URL` configured.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  /** Names the dialog through `aria-labelledby`; read out when focus arrives. */
  title: string;
  children: ReactNode;
  /** The confirmation controls, right-aligned under the content. */
  actions?: ReactNode;
}) {
  const { t: tr } = useI18n();
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // The handler is read through a ref so that an inline `onClose={() => …}` —
  // the natural way to call this — cannot re-run the effect below. A dialog
  // holding a form field re-renders its parent on every keystroke, and a
  // re-run would yank focus back to the panel and drop the caret.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    // The handlers below are function declarations, which hoist above the
    // guard, so control-flow narrowing does not reach them. A non-null alias
    // declares the type rather than inferring it.
    const root: HTMLElement = panel;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the panel rather than its first control, so a reader hears the
    // title before any button — and so a dialog that only shows text still
    // has somewhere for focus to go.
    root.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      // The ring is walked by hand rather than left to the browser's tab
      // order: the panel is focusable but deliberately not a tab stop, so it
      // has to count as the seat before the first control and after the last.
      const tabbable = tabbableWithin(root);
      event.preventDefault();
      if (tabbable.length === 0) {
        root.focus();
        return;
      }
      const active = document.activeElement;
      // -1 is the panel itself, or a control the browser moved focus to that
      // is not in the ring; either way the next stop is the end it is heading
      // towards.
      const index = active instanceof HTMLElement ? tabbable.indexOf(active) : -1;
      const at = event.shiftKey
        ? index <= 0
          ? tabbable.length - 1
          : index - 1
        : index < 0
          ? 0
          : (index + 1) % tabbable.length;

      tabbable[at]?.focus();
    }

    // Tab arithmetic alone is not a trap. Focus also leaves a dialog when a
    // background control is clicked or takes it on its own, so pull it back
    // whenever it lands outside the panel.
    function onFocusIn(event: FocusEvent) {
      if (event.target instanceof Node && root.contains(event.target)) return;
      root.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = previousOverflow;
      // Hand focus back to the control that opened the dialog, otherwise a
      // keyboard user dismissing it is dropped at the top of the document.
      // An opener the parent removed while the dialog was open is skipped
      // rather than focused, which would silently do nothing.
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          // Prevent clicking the backdrop from moving focus to document.body.
          event.preventDefault();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="panel max-h-full w-full max-w-lg overflow-y-auto"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-base font-semibold">
            {tr(title)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr("Close dialog")}
            className="-mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-fg/5 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div id={bodyId} className="text-sm">{children}</div>
        {actions && <div className="mt-4 flex flex-wrap justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export { SyncLagIndicator } from "./SyncLagIndicator";
export { Money } from "./Money";
export { NotificationCentre } from "./NotificationCentre";

