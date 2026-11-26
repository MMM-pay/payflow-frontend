// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  EMPTY_ACTION_STATE,
  getActionState,
  mergeActionState,
  toErrorMessage,
  useAction,
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

describe("useAction hook", () => {
  it("tracks run execution, success, and error", async () => {
    const { result } = renderHook(() => useAction());

    await act(async () => {
      await result.current.run("test", async () => "ok");
    });
    expect(result.current.states.test).toEqual({ busy: false, error: null, done: true });

    await act(async () => {
      await result.current.run("test", async () => {
        throw new Error("fail");
      });
    });
    expect(result.current.states.test).toEqual({ busy: false, error: "fail", done: false });

    act(() => {
      result.current.reset("test");
    });
    expect(result.current.states.test).toEqual(EMPTY_ACTION_STATE);
  });

  it("ignores stale runs when a newer run supersedes", async () => {
    const { result } = renderHook(() => useAction());

    let resolve1!: (val: string) => void;
    let reject1!: (err: Error) => void;

    let p1!: Promise<string | undefined>;
    let p2!: Promise<string | undefined>;

    act(() => {
      p1 = result.current.run("key", () => new Promise<string>((res) => { resolve1 = res; }));
      p2 = result.current.run("key", () => Promise.resolve("second"));
    });

    await act(async () => {
      await p2;
      resolve1("first");
      await p1;
    });
    expect(result.current.states.key).toEqual({ busy: false, error: null, done: true });

    let p3!: Promise<string | undefined>;
    let p4!: Promise<string | undefined>;
    act(() => {
      p3 = result.current.run("key", () => new Promise<string>((_, rej) => { reject1 = rej; }));
      p4 = result.current.run("key", () => Promise.resolve("fourth"));
    });

    await act(async () => {
      await p4;
      reject1(new Error("stale error"));
      await p3;
    });
    expect(result.current.states.key).toEqual({ busy: false, error: null, done: true });
  });
});
