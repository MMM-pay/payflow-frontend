"use client";

import { useI18n } from "@/i18n/provider";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

/** What Tab can reach inside a dialog. `disabled` controls and `tabindex="-1"`
 *  are not tabbable, so they must not be part of the ring either. */
const DIALOG_TABABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tabbableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(DIALOG_TABABLE));
}

/**
 * A modal dialog: focus moves in when it opens, cannot get out while it stays
 * open, Escape closes it, and focus returns to whatever opened it.
 *
 * Confirmations in this app are inline buttons or `window.confirm`, which
 * cannot be styled, labelled, or kept in reach on a phone — this is the
 * primitive they switch to. It holds no data of its own, so it behaves the
 * same with and without `NEXT_PUBLIC_API_URL` configured.
 *
 * Lives outside `ui.tsx` so that pages without a dialog do not pay for it in
 * their first-load bundle.
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
  const descriptionId = useId();
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

      event.preventDefault();
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
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
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
        <div id={descriptionId} className="text-sm">{children}</div>
        {actions && <div className="mt-4 flex flex-wrap justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}
