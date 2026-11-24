/**
 * Keyboard shortcuts for moving between the sections of a long page.
 *
 * The pure pieces live here so they can be tested without a browser; the
 * component in `components/SectionShortcuts.tsx` wires them to the DOM.
 */

export type SectionDirection = "next" | "previous";

/** Keys, matched on `event.key` so they follow the visitor's keyboard layout. */
export const NEXT_SECTION_KEY = "j";
export const PREVIOUS_SECTION_KEY = "k";

/** Maps a key press to a direction, or `null` when it is not ours. */
export function directionForKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
}): SectionDirection | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (key === NEXT_SECTION_KEY) return "next";
  if (key === PREVIOUS_SECTION_KEY) return "previous";
  return null;
}

/**
 * True when the key press is meant for something the visitor is typing into
 * or operating, so a shortcut must stay out of the way.
 */
export function isTypingTarget(target: unknown): boolean {
  const el = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    getAttribute?: (name: string) => string | null;
  } | null;
  if (!el || typeof el !== "object") return false;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable === true) return true;
  const role = typeof el.getAttribute === "function" ? el.getAttribute("role") : null;
  return role === "textbox" || role === "combobox" || role === "searchbox" || role === "spinbutton";
}

/**
 * Index of the section the visitor is "in": the last one whose top edge has
 * reached `threshold` pixels from the top of the viewport. Before the first
 * section is reached it is `-1`.
 */
export function currentSectionIndex(tops: readonly number[], threshold: number): number {
  let current = -1;
  for (let i = 0; i < tops.length; i += 1) {
    const top = tops[i];
    if (typeof top === "number" && Number.isFinite(top) && top <= threshold) current = i;
  }
  return current;
}

/**
 * The section to jump to. Stops at either end rather than wrapping, so a
 * repeated press never throws the visitor from the bottom back to the top.
 * Returns `null` when there is nothing to move to.
 */
export function targetSectionIndex(
  current: number,
  count: number,
  direction: SectionDirection,
): number | null {
  if (!Number.isInteger(count) || count <= 0) return null;
  const from = Number.isInteger(current) ? Math.min(Math.max(current, -1), count - 1) : -1;
  const target = direction === "next" ? from + 1 : from <= 0 ? 0 : from - 1;
  if (target < 0 || target > count - 1) return null;
  if (target === from) return null;
  return target;
}
