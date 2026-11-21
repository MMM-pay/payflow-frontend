"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

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

const MAX_TOASTS = 3;

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = (toast: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => {
      const next = [...prev, { id, ...toast }];
      if (next.length > MAX_TOASTS) {
        next.shift();
      }
      return next;
    });
    return id;
  };

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  useEffect(() => {
    const escapeHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const visible = toasts.find((t) => t.id !== undefined);
        if (visible) {
          dismiss(visible.id);
        }
      }
    };
    document.addEventListener("keydown", escapeHandler);
    return () => {
      document.removeEventListener("keydown", escapeHandler);
    };
  }, [toasts]);

  return { toast, toasts, dismiss };
}

export function useToastHook() {
  return useToast();
}

function getToastClasses(t: Toast): string {
  const base = "rounded-lg border p-4 shadow-sm max-w-md animate-in fade-in-0 sm:animate-in transition-all ease-out duration-300 bg-fg/90 text-fg pointer-events-auto";
  const actionClass = t.action ? "cursor-pointer" : "";
  return `${base} ${actionClass}`.trim();
}

export function ToastProvider({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { toast, toasts, dismiss } = useToast();

  return (
    <>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`fixed top-4 right-4 z-50 space-y-2 ${className || ""} pointer-events-none`}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={getToastClasses(t)}
            onClick={() => {}}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="h-5 w-5 text-fg"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{t.title}</p>
                {t.description && (
                  <p className="text-sm text-muted mt-1">{t.description}</p>
                )}
              </div>
              {t.action && (
                <button
                  type="button"
                  className="ml-2 text-soft hover-underline"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  aria-label={t.action.label}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              className="absolute right-2 top-2 rounded-lg bg-fg/10 p-0.5 hover:bg-fg/20"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.id);
              }}
              aria-label="Dismiss notification"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="h-4 w-4"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </>
  );
}