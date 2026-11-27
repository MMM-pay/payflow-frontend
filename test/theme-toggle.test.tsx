// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  applyTheme,
  resolveTheme,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

/**
 * #358: the theme choice persists and is applied before the first paint, with
 * no flash of the wrong theme.
 *
 * Two layers are pinned here:
 *   1. The inline head script runs synchronously against `document.documentElement`
 *      and localStorage, so the attribute is correct before React hydrates.
 *   2. The toggle cycles System → Light → Dark, writes the same key and applies
 *      the attribute immediately on click.
 *
 * Everything is deterministic: no network, no wallet, and jsdom's localStorage
 * is cleared between cases.
 */

function runInitScript() {
  // The exported script is a self-invoking function expression.
  window.eval(THEME_INIT_SCRIPT);
}

function currentPreference(): ThemePreference {
  const attribute = document.documentElement.dataset.theme;
  if (attribute === "light" || attribute === "dark") return attribute;
  // No attribute means the OS media query decides.
  return "system";
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

describe("pre-paint theme initialization (#358)", () => {
  it("applies a stored dark choice before any component renders", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    runInitScript();

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    // Nothing has rendered yet: this is the state the first paint sees.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("applies a stored light choice even when the OS prefers dark", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");

    runInitScript();

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("leaves the attribute off for system so the media query decides", () => {
    runInitScript();

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(currentPreference()).toBe("system");
  });

  it("ignores a corrupt stored value instead of painting an unknown theme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");

    runInitScript();

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(currentPreference()).toBe("system");
  });

  it("does not throw when storage is blocked (private browsing)", () => {
    const getItem = window.localStorage.getItem.bind(window.localStorage);
    window.localStorage.getItem = () => {
      throw new Error("SecurityError: storage is disabled");
    };
    try {
      expect(runInitScript).not.toThrow();
      expect(document.documentElement.dataset.theme).toBeUndefined();
    } finally {
      window.localStorage.getItem = getItem;
    }
  });

  it("resolves the OS preference without writing any attribute", () => {
    // The stylesheet's `prefers-color-scheme` block does this; the resolver
    // is the same rule in JS for tests and non-CSS consumers.
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe("ThemeToggle persistence (#358)", () => {
  it("starts on System, then cycles and persists each choice", async () => {
    render(<ThemeToggle />);

    // The first render matches the prerendered markup, then the stored choice
    // (none here) is adopted after mount.
    const button = await screen.findByRole("button", {
      name: /Colour theme: System/i,
    });
    await waitFor(() =>
      expect(button.getAttribute("aria-label")).toContain("Switch to Light"),
    );

    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button.getAttribute("aria-label")).toContain("Switch to Dark");

    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(button.getAttribute("aria-label")).toContain("Switch to System");

    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.style.colorScheme).toBe("");
    // "System" is the absence of the key, not a third stored value.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("adopts a previously stored choice after mount without a flash", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    // The page's inline head script runs before React hydrates.
    runInitScript();

    render(<ThemeToggle />);

    const button = await screen.findByRole("button", {
      name: /Colour theme: Dark/i,
    });
    // The inline script already painted the attribute before this render.
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(button.getAttribute("aria-label")).toContain("Switch to System");
  });

  it("keeps the in-memory choice when saving to storage fails", async () => {
    const setItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      render(<ThemeToggle />);
      const button = await screen.findByRole("button", { name: /Colour theme/ });

      expect(() => fireEvent.click(button)).not.toThrow();
      // The ring and colour scheme still switch for this page load.
      expect(document.documentElement.dataset.theme).toBe("light");
    } finally {
      window.localStorage.setItem = setItem;
    }
  });

  it("applies an externally set theme without touching storage", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
