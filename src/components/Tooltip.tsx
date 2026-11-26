"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

/**
 * A tooltip for short inline help, following WAI-ARIA's tooltip pattern and
 * WCAG 1.4.13 (content on hover or focus):
 *
 * - it opens on pointer hover and on keyboard focus, not on hover alone;
 * - it stays open while the pointer is over the tooltip itself (hoverable);
 * - Escape closes it without moving focus (dismissible);
 * - it is tied to its trigger with `aria-describedby`, so a screen reader
 *   reads it after the trigger's name.
 *
 * Colours come from the theme tokens, so it follows light and dark mode, and
 * it has no animation to switch off for reduced motion. Empty `content`
 * renders the trigger alone: there is nothing to explain.
 *
 * `Tooltip` wraps inline text and makes it focusable. For a form field, use
 * `InfoTip`, which renders its own labelled button.
 */
export function Tooltip({
  content,
  children,
  announce = true,
  className = "",
}: {
  content: ReactNode;
  children: ReactNode;
  /**
   * False when the trigger already carries the same text for screen readers
   * (as `TimeAgo` does), so it is not read out twice.
   */
  announce?: boolean;
  className?: string;
}) {
  const { id, open, show, hide, triggerProps } = useTooltip(announce);
  if (isEmpty(content)) return <>{children}</>;
  return (
    <span className={`relative inline-flex ${className}`} onMouseEnter={show} onMouseLeave={hide}>
      <span
        tabIndex={0}
        className="cursor-help rounded underline decoration-dotted decoration-muted underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        {...triggerProps}
      >
        {children}
      </span>
      <Bubble id={id} open={open} announce={announce}>
        {content}
      </Bubble>
    </span>
  );
}

/**
 * A small "?" button that explains a field, e.g. the protocol fee or a
 * mandate's charge cap. `label` is the button's accessible name ("About the
 * protocol fee"); the explanation is its description. Pressing the button
 * toggles the tooltip, so it also works on touch screens, which have no hover.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const { id, open, show, hide, toggle, triggerProps } = useTooltip(true);
  if (isEmpty(children)) return null;
  return (
    <span className="relative inline-flex align-middle" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-edge text-[0.7rem] font-semibold leading-none text-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onClick={toggle}
        {...triggerProps}
      >
        <span aria-hidden="true">?</span>
      </button>
      <Bubble id={id} open={open} announce>
        {children}
      </Bubble>
    </span>
  );
}

function useTooltip(announce: boolean) {
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return {
    id,
    open,
    show,
    hide,
    toggle: () => setOpen((value) => !value),
    triggerProps: {
      onFocus: show,
      onBlur: hide,
      "aria-describedby": announce ? id : undefined,
    },
  };
}

function Bubble({
  id,
  open,
  announce,
  children,
}: {
  id: string;
  open: boolean;
  announce: boolean;
  children: ReactNode;
}) {
  // Always in the DOM so `aria-describedby` resolves; `hidden` keeps it off
  // screen and out of the accessibility tree's reading order until shown.
  return (
    <span
      role="tooltip"
      id={id}
      hidden={!open}
      aria-hidden={announce ? undefined : true}
      className="absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[16rem] -translate-x-1/2 whitespace-normal rounded-md border border-edge bg-panel px-2 py-1 text-left text-xs font-normal normal-case text-fg shadow-lg"
    >
      {children}
    </span>
  );
}

function isEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === false || value === "";
}
