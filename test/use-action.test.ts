import { describe, expect, it } from "vitest";

import {
  EMPTY_ACTION_STATE,
  getActionState,
  mergeActionState,
  toErrorMessage,
} from "../src/lib/useAction";

describe("getActionState", () => {
  it("returns the empty state for an unknown key", () => {
    expect(getActionState({}, "missing")).toEqual(EMPTY_ACTION_STATE);
  });

  it("returns the stored state for a known key", () => {
    const state = { busy: true, error: null, done: false };
    expect(getActionState({ cancel: state }, "cancel")).toEqual(state);
  });

  it("does not mutate the input map", () => {
    const input = {};
    getActionState(input, "key");
    expect(input).toEqual({});
  });
});

describe("mergeActionState", () => {
  it("adds a new key without mutating the input", () => {
    const input = {};
    const out = mergeActionState(input, "subscribe", { busy: true });
    expect(out).toEqual({
      subscribe: { busy: true, error: null, done: false },
    });
    expect(input).toEqual({});
  });

  it("merges a patch into an existing key", () => {
    const input = {
      subscribe: { busy: true, error: null, done: false },
    };
    const out = mergeActionState(input, "subscribe", {
      busy: false,
      done: true,
    });
    expect(out.subscribe).toEqual({ busy: false, error: null, done: true });
    // Other keys are preserved.
    expect(out.subscribe).toBeDefined();
  });

  it("keeps other keys untouched", () => {
    const input = {
      a: { busy: true, error: null, done: false },
      b: { busy: false, error: "nope", done: false },
    };
    const out = mergeActionState(input, "a", { busy: false, done: true });
    expect(out.b).toEqual(input.b);
  });

  it("can set an error and clear done", () => {
    const out = mergeActionState({}, "key", {
      busy: false,
      error: "boom",
      done: false,
    });
    expect(out.key).toEqual({ busy: false, error: "boom", done: false });
  });
});

describe("toErrorMessage", () => {
  it("returns the message of an Error", () => {
    expect(toErrorMessage(new Error("not enough funds"))).toBe("not enough funds");
  });

  it("falls back for an empty Error message", () => {
    expect(toErrorMessage(new Error(""))).toBe("Something went wrong.");
  });

  it("returns a non-empty string as is", () => {
    expect(toErrorMessage("wallet rejected")).toBe("wallet rejected");
  });

  it("falls back for an empty string", () => {
    expect(toErrorMessage("")).toBe("Something went wrong.");
  });

  it("falls back for null and undefined", () => {
    expect(toErrorMessage(null)).toBe("Something went wrong.");
    expect(toErrorMessage(undefined)).toBe("Something went wrong.");
  });

  it("falls back for a plain object", () => {
    expect(toErrorMessage({ code: 123 })).toBe("Something went wrong.");
  });
});
