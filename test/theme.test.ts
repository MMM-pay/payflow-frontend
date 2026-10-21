// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyTheme,
  normalizeTheme,
  resolveTheme,
  saveTheme,
  storedTheme,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    dump: () => data,
  };
}

describe("normalizeTheme", () => {
  it("accepts the three known preferences", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("system")).toBe("system");
  });

  it("falls back to the system for missing or corrupt values", () => {
    expect(normalizeTheme(null)).toBe("system");
    expect(normalizeTheme(undefined)).toBe("system");
    expect(normalizeTheme("sepia")).toBe("system");
    expect(normalizeTheme(1)).toBe("system");
  });
});

describe("storedTheme and saveTheme", () => {
  it("round-trips a manual choice and clears it for system", () => {
    const storage = memoryStorage();

    saveTheme(storage, "dark");
    expect(storedTheme(storage)).toBe("dark");

    saveTheme(storage, "light");
    expect(storedTheme(storage)).toBe("light");

    saveTheme(storage, "system");
    expect(storage.dump().has(THEME_STORAGE_KEY)).toBe(false);
    expect(storedTheme(storage)).toBe("system");
  });

  it("treats unavailable storage as system", () => {
    expect(storedTheme(null)).toBe("system");
    expect(() => saveTheme(null, "dark")).not.toThrow();
  });
});

describe("resolveTheme", () => {
  it("uses an explicit choice regardless of the OS", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the OS on system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("applyTheme", () => {
  it("sets the data attribute for manual choices and removes it for system", () => {
    const root = document.documentElement;

    applyTheme("dark", root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");

    applyTheme("light", root);
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");

    applyTheme("system", root);
    expect(root.dataset.theme).toBeUndefined();
    expect(root.style.colorScheme).toBe("");
  });

  it("is a no-op without a root element", () => {
    expect(() => applyTheme("dark", null)).not.toThrow();
  });
});

describe("THEME_INIT_SCRIPT", () => {
  it("reads the same storage key and only sets an explicit choice", () => {
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain("dataset.theme");
    expect(THEME_INIT_SCRIPT).toContain("light");
    expect(THEME_INIT_SCRIPT).toContain("dark");
  });
});
