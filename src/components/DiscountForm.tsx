"use client";

import { useState } from "react";
import { ConfirmDialog, confirmTitle } from "@/components/ConfirmDialog";
import { InfoTip } from "@/components/Tooltip";
import { useI18n } from "@/i18n/provider";
import {
  checkDiscountBps,
  checkDiscountCharges,
  discountImpact,
  discountNeedsConfirmation,
  discountedAmount,
} from "@/lib/discount";
import type { TokenMeta } from "@/lib/format";

/**
 * The discount a merchant can attach to one mandate.
 *
 * The rate is a percentage the merchant types; it is converted to basis
 * points in integer arithmetic, and the preview says what the subscriber pays
 * while the discount runs and what they pay after it. The discount can only
 * lower the price, so the preview never shows more than the plan's price.
 *
 * Before the merchant signs, it says what the discount would do to the
 * subscriber when that could end the mandate (issue #396): a rate that rounds
 * the charge to zero, which the vault cannot debit, or more discounted charges
 * than the mandate's charge cap leaves. Either one is shown as soon as the
 * inputs produce it and must be confirmed in a dialog before it is applied.
 */
export function DiscountForm({
  amount,
  meta,
  busy,
  maxCharges = 0,
  chargesMade = 0,
  onCancel,
  onApply,
}: {
  amount: bigint;
  meta: TokenMeta;
  busy: boolean;
  /** The mandate's charge cap (0 = open-ended) and the charges it has made. */
  maxCharges?: number;
  chargesMade?: number;
  onCancel: () => void;
  onApply: (bps: number, charges: number) => void;
}) {
  const { t: tr, formatAmount, translateMessage } = useI18n();
  const [percent, setPercent] = useState("10");
  const [charges, setCharges] = useState("3");
  const [confirming, setConfirming] = useState(false);
  const bpsCheck = checkDiscountBps(percent);
  const chargesCheck = checkDiscountCharges(charges);
  const usable = bpsCheck.ok && chargesCheck.ok;
  const impact =
    bpsCheck.ok && chargesCheck.ok
      ? discountImpact(amount, bpsCheck.bps, chargesCheck.charges, maxCharges, chargesMade)
      : null;
  const needsConfirmation = impact !== null && discountNeedsConfirmation(impact);
  const impactText = impact && (
    <ul className="list-disc space-y-1 pl-5">
      {impact.zeroCharge && (
        <li>{tr("This discount rounds the charge down to zero, which the vault cannot debit.")}{" "}{tr("The charge will fail, the mandate goes past due, and it can end when the grace period runs out.")}</li>
      )}
      {impact.outlastsCap && (
        <li>{tr("This mandate's charge cap ends it after {0} more charges, so only {0} of the {1} discounted charges will apply.", { "0": impact.outlastsCap.remaining, "1": impact.outlastsCap.covered })}</li>
      )}
    </ul>
  );

  return (
    <div className="mt-3 rounded-lg border border-edge p-3">
      <p className="text-sm font-medium">{tr("Discount this mandate")}</p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <div className="min-w-[7rem] flex-1">
          <label className="label" htmlFor="discount-percent">{tr("Discount (%)")}</label>
          <input
            id="discount-percent"
            className="input"
            inputMode="decimal"
            placeholder="10"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            aria-invalid={!bpsCheck.ok}
            aria-describedby={bpsCheck.ok ? undefined : "discount-percent-error"}
            disabled={busy}
          />
        </div>
        <div className="min-w-[9rem] flex-1">
          <div className="flex items-center gap-1">
            <label className="label" htmlFor="discount-charges">{tr("Charges to cover")}</label>
            <InfoTip label={tr("About the number of discounted charges")}>
              {tr("How many of the next charges get the discount. After that the subscriber pays the full plan price.")}
            </InfoTip>
          </div>
          <input
            id="discount-charges"
            className="input"
            inputMode="numeric"
            placeholder="3"
            value={charges}
            onChange={(e) => setCharges(e.target.value)}
            aria-invalid={!chargesCheck.ok}
            aria-describedby={chargesCheck.ok ? undefined : "discount-charges-error"}
            disabled={busy}
          />
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !usable}
          onClick={() => {
            if (!bpsCheck.ok || !chargesCheck.ok) return;
            if (needsConfirmation) {
              setConfirming(true);
              return;
            }
            onApply(bpsCheck.bps, chargesCheck.charges);
          }}
        >
          {busy ?tr("Applying…") :tr("Apply discount")}
        </button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>{tr("Cancel")}</button>
      </div>

      {!bpsCheck.ok && (
        <p id="discount-percent-error" role="alert" className="mt-2 text-sm text-danger">
          {translateMessage(bpsCheck.message)}
        </p>
      )}
      {!chargesCheck.ok && (
        <p id="discount-charges-error" role="alert" className="mt-2 text-sm text-danger">
          {translateMessage(chargesCheck.message)}
        </p>
      )}

      {bpsCheck.ok && chargesCheck.ok && (
        <p className="mt-2 text-sm text-muted">{tr("Subscriber pays")}{" "}{formatAmount(discountedAmount(amount, bpsCheck.bps), meta)}{" "}{tr("for the next")}{" "}{chargesCheck.charges === 1 ?tr("charge") :tr("{0} charges", { "0": chargesCheck.charges })},{" "}{tr("then")}{" "}{formatAmount(amount, meta)}.
        </p>
      )}

      <div aria-live="polite">
        {needsConfirmation && (
          <div className="mt-2 rounded-md border border-warn/40 bg-warn/10 p-2 text-sm text-fg">
            <p className="font-medium">{tr("Check the subscriber impact before applying:")}</p>
            {impactText}
          </div>
        )}
      </div>

      {confirming && bpsCheck.ok && chargesCheck.ok && (
        <ConfirmDialog
          open
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onApply(bpsCheck.bps, chargesCheck.charges);
          }}
          title={confirmTitle(tr("Apply this discount anyway"))}
          confirmLabel={tr("Confirm: apply discount")}
          cancelLabel={tr("Change the discount")}
          busy={busy}
          danger={impact?.zeroCharge ?? false}
        >
          <div className="space-y-2 text-sm text-muted">{impactText}</div>
        </ConfirmDialog>
      )}
    </div>
  );
}
