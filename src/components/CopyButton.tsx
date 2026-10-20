"use client";

import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

type CopyState = "idle" | "copied" | "error";

function CopyIcon() {
  return (
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
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

/**
 * Copies the full value, never the truncated text shown beside it. The result
 * is announced through a polite live region so a screen-reader user knows the
 * click worked.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function handleCopy() {
    const ok = await copyToClipboard(value);
    setState(ok ? "copied" : "error");

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ok ? 2_000 : 4_000);
  }

  const announcement =
    state === "copied"
      ? `${label} copied to clipboard`
      : state === "error"
        ? `Could not copy the ${label}`
        : "";

  return (
    <>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition hover:bg-fg/10 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-label={state === "copied" ? `${label} copied` : `Copy ${label}`}
        title={`Copy ${label}`}
      >
        {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
