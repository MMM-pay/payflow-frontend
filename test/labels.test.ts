import { describe, expect, it } from "vitest";
import {
  LABEL_MAX_LENGTH,
  labelStorageKey,
  normalizeLabel,
  readLabel,
  removeLabel,
  saveLabel,
} from "@/lib/labels";

/**
 * Labels are local-only, so the storage edge cases are the feature: a browser
 * that blocks storage must degrade to "no labels", never to a broken page.
 * These tests use plain Storage doubles because `src/lib/labels` is pure apart
 * from the React hook.
 */

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function blockedStorage(): Storage {
  const refuse = () => {
    throw new DOMException("Access is denied for this document.", "SecurityError");
  };
  return {
    get length(): number {
      return refuse();
    },
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  };
}

describe("normalizeLabel", () => {
  it("trims and collapses whitespace so a label is one readable line", () => {
    expect(normalizeLabel("  Alice \n  Smith  ")).toBe("Alice Smith");
  });

  it("treats blank input as no label", () => {
    expect(normalizeLabel("   ")).toBe("");
    expect(normalizeLabel(null)).toBe("");
    expect(normalizeLabel(undefined)).toBe("");
  });

  it("clamps to the limit without leaving a trailing space", () => {
    const label = normalizeLabel("a".repeat(LABEL_MAX_LENGTH + 10));
    expect(label).toHaveLength(LABEL_MAX_LENGTH);
    // A space exactly at the boundary is trimmed after the clamp, so the
    // label loses it rather than ending in whitespace.
    const atBoundary = normalizeLabel(`${"a".repeat(LABEL_MAX_LENGTH - 1)} tail`);
    expect(atBoundary).toHaveLength(LABEL_MAX_LENGTH - 1);
    expect(atBoundary.endsWith(" ")).toBe(false);
    expect(normalizeLabel(`${"a".repeat(LABEL_MAX_LENGTH)} tail`).endsWith(" ")).toBe(false);
  });
});

describe("label storage", () => {
  const address = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";

  it("stores and reads a label per address", () => {
    const storage = memoryStorage();
    expect(saveLabel(address, " Alice ", storage)).toEqual({ ok: true, label: "Alice" });
    expect(readLabel(address, storage)).toBe("Alice");
    expect(storage.getItem(labelStorageKey(address))).toBe("Alice");
  });

  it("keeps each address's label separate", () => {
    const storage = memoryStorage();
    saveLabel(address, "Alice", storage);
    const other = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";
    expect(readLabel(other, storage)).toBeNull();
    saveLabel(other, "Bob", storage);
    expect(readLabel(address, storage)).toBe("Alice");
    expect(readLabel(other, storage)).toBe("Bob");
  });

  it("removes the label when saved blank", () => {
    const storage = memoryStorage();
    saveLabel(address, "Alice", storage);
    expect(saveLabel(address, "   ", storage)).toEqual({ ok: true, label: null });
    expect(readLabel(address, storage)).toBeNull();
    expect(removeLabel(address, storage)).toBe(true);
  });

  it("fails silently when storage is blocked", () => {
    const storage = blockedStorage();
    expect(readLabel(address, storage)).toBeNull();
    expect(saveLabel(address, "Alice", storage)).toEqual({ ok: false });
    expect(removeLabel(address, storage)).toBe(false);
    // The failures above must not throw, and nothing is remembered.
    expect(readLabel(address, storage)).toBeNull();
  });

  it("reports null rather than throwing when there is no storage at all", () => {
    expect(readLabel(address, null)).toBeNull();
    expect(saveLabel(address, "Alice", null)).toEqual({ ok: false });
  });
});
