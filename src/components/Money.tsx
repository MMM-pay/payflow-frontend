"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/i18n/provider";
import { XLM, fromStroops, type TokenMeta } from "@/lib/format";
import { Skeleton } from "@/components/ui";

export interface MoneyProps {
  /**
   * The amount in smallest units (stroops) as a string or bigint, or a number.
   * Null or undefined represents empty or loading state.
   */
  amount: string | bigint | number | null | undefined;
  /** Token metadata (symbol and decimals). Defaults to XLM. */
  meta?: TokenMeta;
  /** Custom symbol override if meta is omitted. */
  symbol?: string;
  /** Maximum fractional digits to show. Defaults to 4. */
  digits?: number;
  /** Whether the amount is currently loading. */
  loading?: boolean;
  /**
   * How to display the +/- sign:
   * - "auto": Show minus for negative amounts, nothing for positive or zero.
   * - "always": Show "+" for positive, "-" for negative, nothing for zero.
   * - "never": Never show any sign (absolute magnitude).
   */
  signDisplay?: "auto" | "always" | "never";
  /**
   * Visual tone for the text:
   * - "auto": text-danger for negative/refunds, text-accent for positive when signed, neutral for zero.
   * - "neutral": Standard foreground text.
   * - "positive": Forces positive styling (text-accent).
   * - "negative": Forces negative styling (text-danger).
   * - "refund": Marks as a refund with negative styling and accessible prefix.
   */
  tone?: "auto" | "neutral" | "positive" | "negative" | "refund";
  /** Whether this amount represents a refund. */
  isRefund?: boolean;
  /** Whether to render the token symbol. Defaults to true. */
  showSymbol?: boolean;
  /** Fallback node when amount is null/undefined and not loading. Defaults to "—". */
  emptyFallback?: ReactNode;
  /** Additional CSS class names. */
  className?: string;
}

/**
 * Pure helper to parse and analyze money input without throwing.
 */
export function parseMoneyValue(raw: string | bigint | number | null | undefined): {
  valid: boolean;
  value: bigint | null;
  isZero: boolean;
  isNegative: boolean;
  isPositive: boolean;
} {
  if (raw === null || raw === undefined || raw === "") {
    return { valid: true, value: null, isZero: false, isNegative: false, isPositive: false };
  }

  try {
    let b: bigint;
    if (typeof raw === "bigint") {
      b = raw;
    } else if (typeof raw === "number") {
      if (!Number.isFinite(raw)) {
        return { valid: false, value: null, isZero: false, isNegative: false, isPositive: false };
      }
      b = BigInt(Math.trunc(raw));
    } else {
      const trimmed = String(raw).trim();
      if (!/^[+-]?\d+$/.test(trimmed)) {
        return { valid: false, value: null, isZero: false, isNegative: false, isPositive: false };
      }
      b = BigInt(trimmed);
    }

    const isZero = b === 0n;
    const isNegative = b < 0n;
    const isPositive = b > 0n;

    return { valid: true, value: b, isZero, isNegative, isPositive };
  } catch {
    return { valid: false, value: null, isZero: false, isNegative: false, isPositive: false };
  }
}

/**
 * Theme-aware and accessible Money component for displaying token amounts.
 * Gracefully handles:
 * - Zero amounts (without negative signs, neutral tone)
 * - Negative and refund amounts (accessible minus/refund announcement, theme-aware danger tone)
 * - Loading, empty, and error states
 */
export function Money({
  amount,
  meta = XLM,
  symbol,
  digits = 4,
  loading = false,
  signDisplay = "auto",
  tone = "auto",
  isRefund = false,
  showSymbol = true,
  emptyFallback = <span className="text-muted">—</span>,
  className = "",
}: MoneyProps) {
  const { locale, formatNumber, t: tr } = useI18n();

  // 1. Loading state
  if (loading) {
    return (
      <span
        role="status"
        aria-busy="true"
        data-testid="money-loading"
        className={`inline-flex items-center ${className}`}
      >
        <Skeleton className="h-5 w-20" />
        <span className="sr-only">{tr("Loading amount…")}</span>
      </span>
    );
  }

  // 2. Parse value
  const parsed = parseMoneyValue(amount);

  // 3. Error state (unparseable / invalid amount)
  if (!parsed.valid) {
    return (
      <span
        role="alert"
        data-testid="money-error"
        className={`text-danger inline-flex items-center text-xs font-medium ${className}`}
      >
        {tr("Invalid amount")}
      </span>
    );
  }

  // 4. Empty state (null / undefined / empty string)
  if (parsed.value === null) {
    return (
      <span data-testid="money-empty" className={className}>
        {emptyFallback}
      </span>
    );
  }

  // 5. Normal amount rendering (positive, zero, or negative/refund)
  const tokenSymbol = symbol ?? meta.symbol;
  const tokenDecimals = meta.decimals;
  const absValue = parsed.isNegative ? -parsed.value : parsed.value;

  const canonical = fromStroops(absValue, digits, tokenDecimals);
  const [, whole = "0", fraction] = /^(\d+)(?:\.(\d+))?$/.exec(canonical) ?? [];

  const decimalSeparator = locale === "fr" || locale === "de" ? "," : ".";
  const formattedNumber = `${formatNumber(BigInt(whole))}${fraction ? decimalSeparator + fraction : ""}`;

  // Sign resolution
  let signStr = "";
  if (parsed.isNegative) {
    signStr = signDisplay === "never" ? "" : "−"; // Unicode minus
  } else if (parsed.isPositive && signDisplay === "always") {
    signStr = "+";
  }

  // Tone resolution
  let resolvedToneClass = "";
  if (tone === "neutral") {
    resolvedToneClass = "text-foreground";
  } else if (tone === "positive") {
    resolvedToneClass = "text-accent";
  } else if (tone === "negative" || tone === "refund") {
    resolvedToneClass = "text-danger";
  } else if (tone === "auto") {
    if (isRefund || parsed.isNegative) {
      resolvedToneClass = "text-danger";
    } else if (parsed.isPositive && signDisplay === "always") {
      resolvedToneClass = "text-accent";
    } else {
      resolvedToneClass = "";
    }
  }

  // Accessible screen reader label
  let ariaDescription: string;
  const unitText = showSymbol && tokenSymbol ? ` ${tokenSymbol}` : "";
  if (isRefund) {
    ariaDescription = `${tr("Refund:")} -${formattedNumber}${unitText}`;
  } else if (parsed.isNegative) {
    ariaDescription = `${tr("minus")} ${formattedNumber}${unitText}`;
  } else if (parsed.isPositive && signDisplay === "always") {
    ariaDescription = `+${formattedNumber}${unitText}`;
  } else {
    ariaDescription = `${formattedNumber}${unitText}`;
  }

  return (
    <span
      className={`inline-flex items-baseline tabular-nums ${resolvedToneClass} ${className}`.trim()}
      aria-label={ariaDescription}
      data-testid="money-amount"
    >
      {isRefund && (
        <>
          <span
            className="me-1.5 rounded bg-danger/15 px-1 py-0.2 text-[10px] font-semibold uppercase tracking-wider text-danger"
            aria-hidden="true"
          >
            {tr("Refund")}
          </span>{" "}
        </>
      )}
      <span className="font-semibold">
        {signStr}
        {formattedNumber}
      </span>
      {showSymbol && tokenSymbol && (
        <>
          {" "}
          <span className="text-xs opacity-80 font-normal">{tokenSymbol}</span>
        </>
      )}
    </span>
  );
}
