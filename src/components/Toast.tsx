"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/provider";

type ToastAction = {
  label: string;
  onClick?: () => void;
};

type Toast = {
  id: string;
  title: string;
  description?: string;
  action?: ToastAction;
  duration?: number;
};

type ToastInput = Omit<Toast, "id">;
type ToastContextValue = {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);
const MAX_TOASTS = 3;
const DEFAULT_DURATION = 5_000;

function ToastItem({
  value,
  dismiss,
}: {
  value: Toast;
  dismiss: (id: string) => void;
}) {
  const { t: tr } = useI18n();

  useEffect(() => {
    if (value.duration === 0) return;
    const timer = window.setTimeout(
      () => dismiss(value.id),
      value.duration ?? DEFAULT_DURATION,
    );
    return () => window.clearTimeout(timer);
  }, [dismiss, value.duration, value.id]);

  return (
    <div
      role="group"
      aria-label={value.title}
      className="relative pointer-events-auto max-w-md rounded-lg border bg-fg/90 p-4 pe-10 text-fg shadow-sm transition-all ease-out duration-300"
    >
      <div className="font-medium">{value.title}</div>
      {value.description && (
        <p className="mt-1 text-sm text-muted">{value.description}</p>
      )}
      {value.action && (
        <button
          type="button"
          className="mt-2 rounded text-sm text-soft hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => {
            value.action?.onClick?.();
            dismiss(value.id);
          }}
        >
          {value.action.label}
        </button>
      )}
      <button
        type="button"
        className="absolute end-2 top-2 rounded-lg bg-fg/10 p-1 hover:bg-fg/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => dismiss(value.id)}
        aria-label={tr("Dismiss notification")}
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
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function useToastHook() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToastHook must be used within a ToastProvider.");
  }
  return context;
}

export function ToastProvider({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((input: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((previous) => [...previous, { id, ...input }].slice(-MAX_TOASTS));
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((previous) => previous.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    const escapeHandler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || toasts.length === 0) return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"]')
      ) {
        return;
      }
      event.preventDefault();
      dismiss(toasts[toasts.length - 1]!.id);
    };
    document.addEventListener("keydown", escapeHandler);
    return () => document.removeEventListener("keydown", escapeHandler);
  }, [dismiss, toasts]);

  const latest = toasts[toasts.length - 1];

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div
        className={`pointer-events-none fixed end-4 top-4 z-50 space-y-2 ${className ?? ""}`}
      >
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {latest && (
            <>
              {latest.title}
              {latest.description ? `. ${latest.description}` : ""}
            </>
          )}
        </div>
        {toasts.map((value) => (
          <ToastItem key={value.id} value={value} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
