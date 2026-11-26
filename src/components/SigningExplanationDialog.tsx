"use client";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useI18n } from "@/i18n/provider";

export function SigningExplanationDialog({
  description,
  onCancel,
  onConfirm,
}: {
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t: tr, translateMessage } = useI18n();

  return (
    <ConfirmDialog
      open
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="Review this wallet action?"
      confirmLabel={tr("Continue to wallet")}
    >
      <p>
        {tr("This transaction will {0}. Review the details in your wallet before signing.", {
          "0": translateMessage(description),
        })}
      </p>
    </ConfirmDialog>
  );
}
