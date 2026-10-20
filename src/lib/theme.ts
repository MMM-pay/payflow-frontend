/**
 * Theme preference handling.
 *
 * The app follows the OS preference until the reader chooses otherwise. The
 * choice lives in localStorage under one key; "system" is represented by the
 * absence of that key, so clearing it is the same as asking to follow the OS.
 *
 * Everything here except `applyTheme` is a pure function, which keeps the
 * decision-making testable without a DOM.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "payflow-theme";

/** Coerce anything read from storage or an input into a known preference. */
export function normalizeTheme(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

/**
 * Read the stored preference, treating unavailable or corrupt storage as
 * "follow the system". Private browsing modes can throw on access.
 */
export function storedTheme(
  storage: Pick<Storage, "getItem"> | null | undefined,
): ThemePreference {
  if (!storage) return "system";
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** Persist a choice. "system" clears the key rather than storing a third value. */
export function saveTheme(
  storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined,
  preference: ThemePreference,
): void {
  if (!storage) return;
  try {
    if (preference === "system") storage.removeItem(THEME_STORAGE_KEY);
    else storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode, quota); the in-memory choice
    // still applies for this page load.
  }
}

/** The theme actually painted, given a preference and the OS setting. */
export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (preference === "light" || preference === "dark") return preference;
  return prefersDark ? "dark" : "light";
}

/**
 * The `data-theme` attribute for a preference, or null when the OS should
 * decide. Null is what makes "system" reactive to OS changes without JS.
 */
export function themeAttribute(
  preference: ThemePreference,
): ResolvedTheme | null {
  return preference === "system" ? null : preference;
}

/**
 * Apply a preference to the document. `color-scheme` is set alongside the
 * attribute so form controls and scrollbars match the page rather than the OS.
 */
export function applyTheme(
  preference: ThemePreference,
  root: HTMLElement | null = typeof document === "undefined"
    ? null
    : document.documentElement,
): void {
  if (!root) return;
  const attribute = themeAttribute(preference);
  if (attribute) {
    root.dataset.theme = attribute;
    root.style.colorScheme = attribute;
  } else {
    delete root.dataset.theme;
    root.style.colorScheme = "";
  }
}

/**
 * Runs synchronously in `<head>` before the first paint.
 *
 * Only a stored light/dark choice needs an attribute: with no attribute the
 * media query in `globals.css` already renders the system preference. Keeping
 * the script tiny matters — it blocks rendering.
 */
export const THEME_INIT_SCRIPT =
  `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  `if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;` +
  `document.documentElement.style.colorScheme=t;}}catch(e){}})();`;
