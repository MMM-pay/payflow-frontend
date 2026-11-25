import { describe, expect, it } from "vitest";
import {
  currentSectionIndex,
  directionForKey,
  isTypingTarget,
  targetSectionIndex,
} from "@/lib/section-shortcuts";

const press = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("directionForKey", () => {
  it("maps J to next and K to previous, in either case", () => {
    expect(directionForKey(press("j"))).toBe("next");
    expect(directionForKey(press("J"))).toBe("next");
    expect(directionForKey(press("k"))).toBe("previous");
    expect(directionForKey(press("K"))).toBe("previous");
  });

  it("ignores other keys", () => {
    for (const key of ["a", "ArrowDown", "Tab", "Enter", " ", "Escape", "1", "]", "[", "jj", ""]) {
      expect(directionForKey(press(key)), JSON.stringify(key)).toBeNull();
    }
  });

  it("leaves browser and OS shortcuts alone when a modifier is held", () => {
    // Ctrl+K and Cmd+K are search/command palettes in most browsers.
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
      expect(directionForKey(press("k", { [mod]: true })), mod).toBeNull();
      expect(directionForKey(press("j", { [mod]: true })), mod).toBeNull();
    }
  });
});

describe("isTypingTarget", () => {
  const el = (props: Record<string, unknown>) => ({
    getAttribute: () => null,
    ...props,
  });

  it("treats form fields as typing", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input", "textarea"]) {
      expect(isTypingTarget(el({ tagName })), tagName).toBe(true);
    }
  });

  it("treats editable regions and text-entry roles as typing", () => {
    expect(isTypingTarget(el({ tagName: "DIV", isContentEditable: true }))).toBe(true);
    for (const role of ["textbox", "combobox", "searchbox", "spinbutton"]) {
      expect(isTypingTarget({ tagName: "DIV", getAttribute: () => role }), role).toBe(true);
    }
  });

  it("does not treat links, buttons or plain content as typing", () => {
    for (const tagName of ["A", "BUTTON", "DIV", "BODY", "SECTION"]) {
      expect(isTypingTarget(el({ tagName })), tagName).toBe(false);
    }
  });

  it("is false for missing or odd targets", () => {
    for (const value of [null, undefined, 0, "input", {}, []]) {
      expect(isTypingTarget(value), String(value)).toBe(false);
    }
  });
});

describe("currentSectionIndex", () => {
  it("is -1 before the first section is reached", () => {
    expect(currentSectionIndex([300, 900, 1500], 120)).toBe(-1);
    expect(currentSectionIndex([], 120)).toBe(-1);
  });

  it("is the last section whose top has reached the threshold", () => {
    expect(currentSectionIndex([100, 700, 1300], 120)).toBe(0);
    expect(currentSectionIndex([-500, 100, 800], 120)).toBe(1);
    expect(currentSectionIndex([-1500, -900, -200], 120)).toBe(2);
  });

  it("counts a section whose top sits exactly on the threshold", () => {
    expect(currentSectionIndex([120, 700], 120)).toBe(0);
  });

  it("ignores non-finite measurements", () => {
    expect(currentSectionIndex([Number.NaN, -10, Number.POSITIVE_INFINITY], 120)).toBe(1);
  });
});

describe("targetSectionIndex", () => {
  it("moves one section at a time", () => {
    expect(targetSectionIndex(0, 5, "next")).toBe(1);
    expect(targetSectionIndex(3, 5, "next")).toBe(4);
    expect(targetSectionIndex(4, 5, "previous")).toBe(3);
    expect(targetSectionIndex(1, 5, "previous")).toBe(0);
  });

  it("goes to the first section from above the page", () => {
    expect(targetSectionIndex(-1, 5, "next")).toBe(0);
    expect(targetSectionIndex(-1, 5, "previous")).toBe(0);
  });

  it("stops at the ends instead of wrapping", () => {
    expect(targetSectionIndex(4, 5, "next")).toBeNull();
    expect(targetSectionIndex(0, 5, "previous")).toBeNull();
  });

  it("has nowhere to go with no sections", () => {
    for (const direction of ["next", "previous"] as const) {
      expect(targetSectionIndex(-1, 0, direction)).toBeNull();
      expect(targetSectionIndex(0, 0, direction)).toBeNull();
      expect(targetSectionIndex(0, -3, direction)).toBeNull();
      expect(targetSectionIndex(0, Number.NaN, direction)).toBeNull();
    }
  });

  it("works with a single section", () => {
    expect(targetSectionIndex(-1, 1, "next")).toBe(0);
    expect(targetSectionIndex(0, 1, "next")).toBeNull();
    expect(targetSectionIndex(0, 1, "previous")).toBeNull();
  });

  it("clamps a stale index from a page whose sections changed", () => {
    expect(targetSectionIndex(9, 3, "next")).toBeNull();
    expect(targetSectionIndex(9, 3, "previous")).toBe(1);
    expect(targetSectionIndex(Number.NaN, 3, "next")).toBe(0);
  });
});
