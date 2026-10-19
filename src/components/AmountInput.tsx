"use client";

import type { ReactNode } from "react";
import { amountError, normaliseAmountInput } from "@/lib/format";

/**
 * A decimal amount field for money.
 *
 * Users in locales with comma decimals get errors from a field that only
 * accepts `1234.5`, so this field takes what their keyboard produces —
 * `1,234.5`, `1.234,5`, `1,5` — and all of them parse to the same bigint
 * stroops through `parseAmount` at submit time. While typing, the field is
 * filtered to digits plus at most one separator and the fraction is capped at
 * the token's own decimals, so a 6-decimal token cannot be sent a 7th place.
 *
 * The parent page owns the raw string state and reads the bigint back with
 * `parseAmount(value, decimals)` when the user submits.
 */
export function AmountInput({
  id,
  label,
  value,
  onChange,
  decimals,
  placeholder,
  disabled = false,
  hint,
}: {
  id: string;
  label: ReactNode;
  /** Raw field text, e.g. "1,234.5". Owned by the parent. */
  value: string;
  onChange: (next: string) => void;
  /** The token's decimals: the fraction is capped to this many places. */
  decimals: number;
  placeholder?: string;
  disabled?: boolean;
  /** Static help text under the field, shown alongside any error. */
  hint?: ReactNode;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const message = amountError(value, decimals);

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        aria-invalid={message ? true : undefined}
        aria-describedby={
          [message ? errorId : "", hint ? hintId : ""].filter(Boolean).join(" ") ||
          undefined
        }
        onChange={(e) => onChange(normaliseAmountInput(e.target.value, decimals))}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {message && (
        <p id={errorId} className="mt-1 text-sm text-rose-200">
          {message}
        </p>
      )}
    </div>
  );
}
