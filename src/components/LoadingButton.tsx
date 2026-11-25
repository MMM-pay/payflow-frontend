"use client";

import { useI18n } from "@/i18n/provider";
import { useRef } from "react";
import type { MouseEvent, ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "btn-primary",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

/**
 * A button that reports async work and refuses a second submission.
 *
 * Disabling on `loading` alone is not enough: React applies the attribute on
 * the next render, so a double click (or a keyboard user pressing Enter twice)
 * can start two writes before the button is ever disabled. The ref below is
 * set synchronously inside the click handler, which closes that window. The
 * button also stays disabled for as long as the parent says it is busy, so
 * every re-render driven by the surrounding form agrees with it.
 *
 * The new content is announced through `aria-busy` and a visually hidden
 * status sentence; the spinner is decorative, because a spinner with no text
 * is silent to a screen reader. `motion-safe` keeps the spin out for readers
 * who ask their OS to reduce motion.
 */
export function LoadingButton({
  children,
  loading = false,
  loadingText,
  onClick,
  type = "button",
  variant = "primary",
  className = "",
  disabled = false,
  ...rest
}: {
  children: ReactNode;
  /** True while the action is in flight. */
  loading?: boolean;
  /** Replaces the visible label while loading; defaults to the label. */
  loadingText?: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  type?: "button" | "submit" | "reset";
  variant?: Variant;
  className?: string;
  disabled?: boolean;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "type" | "disabled" | "children" | "className"
>) {
  const { t: tr } = useI18n();
  // Synchronous guard for the gap between the click and the disabled render.
  const submitting = useRef(false);

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading || disabled || submitting.current) {
      event.preventDefault();
      return;
    }
    if (!onClick) return;
    submitting.current = true;
    try {
      await onClick(event);
    } finally {
      // A parent that keeps `loading` true is still protected by `disabled`;
      // this only re-opens the button once the caller's work has settled.
      submitting.current = false;
    }
  }

  return (
    <button
      {...rest}
      type={type}
      className={`${VARIANTS[variant]} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={handleClick}
    >
      {loading && (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          className="h-4 w-4 motion-safe:animate-spin"
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="3"
            className="opacity-25"
          />
          <path
            d="M21 12a9 9 0 0 0-9-9"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      )}
      {loading && loadingText !== undefined ? loadingText : children}
      {loading && <span className="sr-only">{tr("Working…")}</span>}
    </button>
  );
}
