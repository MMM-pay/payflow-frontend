"use client";

import { useId } from "react";
import { useI18n } from "@/i18n/provider";

/**
 * A labelled search field used by the plan listings.
 *
 * The label is visually hidden but present for screen readers (and as the
 * accessible name in tests). Typing is reported through `onChange`; the clear
 * button appears only when there is text and is reachable by keyboard. Colours
 * come from the app's token classes so it follows both themes.
 */
export function Search({
  id,
  label = "Search plans",
  placeholder = "Search by name",
  value,
  onChange,
  className = "",
}: {
  /** Optional DOM id; one is generated when omitted. */
  id?: string;
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const { t: tr } = useI18n();
  const generatedId = useId();
  const inputId = id ?? `search-${generatedId}`;

  return (
    <div className={`relative min-w-[12rem] flex-1 ${className}`} role="search">
      <label htmlFor={inputId} className="sr-only">
        {tr(label)}
      </label>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        id={inputId}
        type="search"
        className="input ps-9 pe-9"
        value={value}
        placeholder={tr(placeholder)}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
      {value !== "" && (
        <button
          type="button"
          aria-label={tr("Clear search")}
          onClick={() => onChange("")}
          className="absolute end-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted transition hover:bg-fg/10 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
