"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider";
import {
  currentSectionIndex,
  directionForKey,
  isTypingTarget,
  NEXT_SECTION_KEY,
  PREVIOUS_SECTION_KEY,
  targetSectionIndex,
} from "@/lib/section-shortcuts";

/** Panels on the page, in reading order. */
const SECTION_SELECTOR = "main section.panel";

/** A section counts as reached once its top is in the upper part of the screen. */
const REACHED_OFFSET_PX = 120;

function headingOf(section: HTMLElement): string {
  return section.querySelector("h2")?.textContent?.trim() ?? "";
}

function dialogIsOpen(): boolean {
  return document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * Press J / K to move to the next / previous section of the page. Focus moves
 * with the scroll, so the choice is announced and the next Tab continues from
 * there. Shortcuts stay quiet while typing, with modifier keys held, or while a
 * dialog is open. A visible hint says they exist.
 */
export function SectionShortcuts() {
  const { t: tr } = useI18n();
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return;
      const direction = directionForKey(event);
      if (!direction) return;
      if (isTypingTarget(event.target) || dialogIsOpen()) return;

      const sections = Array.from(document.querySelectorAll<HTMLElement>(SECTION_SELECTOR));
      if (sections.length === 0) return;

      const current = currentSectionIndex(
        sections.map((section) => section.getBoundingClientRect().top),
        REACHED_OFFSET_PX,
      );
      const target = targetSectionIndex(current, sections.length, direction);
      if (target === null) {
        setAnnouncement(direction === "next" ? tr("Last section") : tr("First section"));
        return;
      }

      const section = sections[target];
      if (!section) return;
      event.preventDefault();
      if (!section.hasAttribute("tabindex")) section.setAttribute("tabindex", "-1");
      section.focus({ preventScroll: true });
      section.scrollIntoView({ block: "start" });
      const name = headingOf(section);
      setAnnouncement(
        tr("Section {0} of {1}: {2}", { "0": target + 1, "1": sections.length, "2": name }),
      );
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tr]);

  return (
    <>
      <p className="hidden text-xs text-muted sm:block" data-testid="section-shortcuts-hint">
        {tr("Press")}{" "}
        <kbd className="rounded border border-edge px-1 font-mono">{NEXT_SECTION_KEY.toUpperCase()}</kbd>{" "}
        {tr("or")}{" "}
        <kbd className="rounded border border-edge px-1 font-mono">{PREVIOUS_SECTION_KEY.toUpperCase()}</kbd>{" "}
        {tr("to jump between sections.")}
      </p>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </>
  );
}
