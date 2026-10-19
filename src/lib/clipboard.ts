/**
 * Copy text to the clipboard, with a fallback for browsers or contexts where
 * the async Clipboard API is unavailable (older Safari, non-secure origins).
 *
 * Dependencies are injectable so the behaviour can be tested without a DOM.
 */

export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export interface CopyDependencies {
  clipboard?: ClipboardWriter | null;
  fallback?: (text: string) => boolean;
}

/** `document.execCommand("copy")` path; only meaningful in a browser. */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // Keep it out of the layout and out of the viewport.
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();

  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } finally {
    area.remove();
  }
}

function defaultClipboard(): ClipboardWriter | null {
  if (typeof navigator === "undefined") return null;
  return navigator.clipboard ?? null;
}

export async function copyToClipboard(
  text: string,
  deps: CopyDependencies = {},
): Promise<boolean> {
  const clipboard = deps.clipboard === undefined ? defaultClipboard() : deps.clipboard;

  if (clipboard) {
    try {
      // The whole value is copied — never the shortened display form.
      await clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or unavailable; fall through to the legacy path.
    }
  }

  try {
    return (deps.fallback ?? legacyCopy)(text);
  } catch {
    return false;
  }
}
