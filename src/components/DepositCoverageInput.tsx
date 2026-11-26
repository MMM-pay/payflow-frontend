"use client";

import { useId, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { AmountInput } from "@/components/AmountInput";
import { LoadingButton } from "@/components/LoadingButton";
import { FieldHint, InlineError } from "@/components/ui";
import {
  DEFAULT_DEPOSIT_PERIODS,
  PERIODS_ERROR,
  amountForPeriods,
  depositCoverage,
  parseDepositPeriods,
  periodsForAmount,
  periodsToAmountText,
} from "@/lib/deposit-amount";
import { fromStroops } from "@/lib/format";

/**
 * The vault deposit field, expressible in periods or in the token itself.
 *
 * Both inputs are always visible and always agree: typing "3" in periods fills
 * the amount with three plan prices, and typing an amount derives the whole
 * periods it covers. The plan price is the only conversion factor, so the two
 * never drift — and a partial amount (less than one period) is still a valid
 * deposit, it simply covers no full period.
 *
 * The deposit itself is a `LoadingButton`, so a slow wallet cannot be opened
 * twice by a double click.
 */
export function DepositCoverageInput({
  planAmount,
  decimals,
  symbol,
  onDeposit,
  busy = false,
  disabled = false,
}: {
  /** Price of one charge, in the token's smallest unit. */
  planAmount: string | bigint;
  decimals: number;
  symbol: string;
  onDeposit: (amount: bigint) => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
}) {
  const { t: tr, localeTag, checkAmount, parseAmount } = useI18n();
  const id = useId();
  const periodsId = `${id}-periods`;
  const amountId = `${id}-amount`;
  const summaryId = `${id}-summary`;
  const errorId = `${id}-error`;

  const [periods, setPeriods] = useState(String(DEFAULT_DEPOSIT_PERIODS));
  const [amount, setAmount] = useState(() =>
    periodsToAmountText(DEFAULT_DEPOSIT_PERIODS, planAmount, decimals),
  );

  function changePeriods(next: string) {
    setPeriods(next);
    const count = parseDepositPeriods(next);
    const total = count === null ? null : amountForPeriods(count, planAmount);
    setAmount(total === null ? "" : fromStroops(total, decimals, decimals));
  }

  function changeAmount(next: string) {
    setAmount(next);
    if (next.trim() === "") {
      setPeriods("");
      return;
    }
    // Only a value the deposit could actually use updates the periods field:
    // a half-typed decimal leaves it alone rather than flickering to zero.
    if (!checkAmount(next, decimals).ok) return;
    const covered = periodsForAmount(parseAmount(next, decimals), planAmount);
    if (covered !== null) setPeriods(String(covered));
  }

  const coverage = depositCoverage(
    "amount",
    amount,
    planAmount,
    decimals,
    localeTag,
  );
  // A periods draft that is not a number is reported even when the amount it
  // produced still parses, because the subscriber is looking at that field.
  const periodsInvalid =
    periods.trim() !== "" && parseDepositPeriods(periods) === null
      ? PERIODS_ERROR
      : null;
  const error = periodsInvalid ?? coverage.error;
  const ready = !error && coverage.amount !== null && coverage.amount > 0n;

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={periodsId}>
            {tr("Periods")}
          </label>
          <input
            id={periodsId}
            className="input"
            inputMode="numeric"
            autoComplete="off"
            value={periods}
            disabled={disabled || busy}
            aria-invalid={periodsInvalid ? true : undefined}
            aria-describedby={error ? errorId : summaryId}
            onChange={(event) => changePeriods(event.target.value)}
          />
        </div>
        <AmountInput
          id={amountId}
          label={tr("Amount ({0})", { "0": symbol })}
          value={amount}
          onChange={changeAmount}
          decimals={decimals}
          disabled={disabled || busy}
          hideError
          invalid={Boolean(error)}
          describedBy={error ? errorId : summaryId}
        />
      </div>
      {error ? (
        <InlineError id={errorId} className="">
          {error}
        </InlineError>
      ) : (
        <FieldHint id={summaryId} className="" live>
          {coverage.periods === null || coverage.amount === null
            ? tr("Enter a coverage amount to see how many periods it funds.")
            : tr("{0} {1} covers {2}.", {
                "0": fromStroops(coverage.amount, decimals, decimals),
                "1": symbol,
                "2":
                  coverage.periods === 1
                    ? tr("1 period")
                    : tr("{0} periods", { "0": coverage.periods }),
              })}
        </FieldHint>
      )}
      <LoadingButton
        variant="primary"
        className="w-full text-xs"
        loading={busy}
        loadingText={tr("Depositing…")}
        disabled={disabled || !ready}
        onClick={() => {
          if (coverage.amount !== null) void onDeposit(coverage.amount);
        }}
      >
        {tr("Deposit")}
      </LoadingButton>
    </div>
  );
}
