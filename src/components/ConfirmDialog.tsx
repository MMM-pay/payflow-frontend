"use client";

import type { ReactNode } from "react";
import { Dialog } from "@/components/Dialog";
import { Notice } from "@/components/ui";
import { LoadingButton } from "@/components/LoadingButton";
import { useI18n } from "@/i18n/provider";

/**
 * The one confirmation dialog.
 *
 * Confirmations used to choose their own words and button order, so the same
 * question could read "Go back / Confirm and sign" on one page and
 * "Fund / Cancel" on another. This fixes the shape everywhere:
 *
 * - the title is a question, naming exactly what will happen;
 * - the safe choice ("Cancel") comes first and the committing choice last,
 *   matching the reading order and every native confirmation;
 * - the committing button is an action label ("Confirm cancellation"), never
 *   a bare "OK";
 * - while the write runs it becomes a `LoadingButton`, so it reports progress
 *   and cannot be submitted twice;
 * - a failure stays on screen as `error`, and Escape/the close button are
 *   ignored while busy, so a write in flight can only end by finishing.
 */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  children,
  confirmLabel,
  cancelLabel,
  busy = false,
  busyLabel,
  danger = false,
  confirmDisabled = false,
  error,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  /** A question naming the action, e.g. "Cancel 2 subscriptions?". */
  title: string;
  children: ReactNode;
  /** Verb and object, e.g. "Confirm cancellation". */
  confirmLabel: string;
  /** Defaults to "Cancel"; kept for contexts where that word is ambiguous. */
  cancelLabel?: string;
  /** True while the confirmed write is in flight. */
  busy?: boolean;
  /** Progress copy shown in place of `confirmLabel` while busy. */
  busyLabel?: ReactNode;
  /** Use the danger colour for an irreversible action. */
  danger?: boolean;
  confirmDisabled?: boolean;
  /** The confirmed write's last failure, so it can be retried or backed out of without losing context. */
  error?: ReactNode;
}) {
  const { t: tr } = useI18n();
  // Escape and the close button both route through `onClose`; swallowing it
  // while busy keeps them in step with the already-disabled Cancel button,
  // so a write in flight cannot be dismissed out from under itself.
  const handleClose = busy ? () => {} : onCancel;
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={title}
      actions={
        <>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel ?? tr("Cancel")}
          </button>
          <LoadingButton
            variant={danger ? "danger" : "primary"}
            loading={busy}
            loadingText={busyLabel}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </LoadingButton>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {children}
    </Dialog>
  );
}
