import { describe, expect, it } from "vitest";
import {
  isSignatureRejection,
  SIGNATURE_CANCELLED_MESSAGE,
  translateSignatureError,
} from "@/lib/signature-error";

/** Runs `translateSignatureError` and returns what it threw. */
function thrownBy(error: unknown): unknown {
  try {
    translateSignatureError(error);
  } catch (caught) {
    return caught;
  }
  throw new Error("translateSignatureError returned instead of throwing");
}

describe("friendly message", () => {
  it("is specific, says nothing was sent, and has no raw code in it", () => {
    expect(SIGNATURE_CANCELLED_MESSAGE).toMatch(/cancelled the signature/i);
    expect(SIGNATURE_CANCELLED_MESSAGE).toMatch(/nothing was sent/i);
    expect(SIGNATURE_CANCELLED_MESSAGE).not.toMatch(/-4|code|rejected/i);
  });
});

describe("SEP-43 rejection code -4", () => {
  it.each([
    ["numeric code on an Error", Object.assign(new Error("anything"), { code: -4 })],
    ["numeric code on a plain object", { message: "x", code: -4 }],
    ["string code", { message: "x", code: "-4" }],
    ["code with no message at all", { code: -4 }],
    ["code on a nested error payload", { error: { code: -4 } }],
    ["code two levels down", { error: { error: { code: -4 } } }],
    ["code three levels down", { error: { error: { error: { code: -4 } } } }],
  ])("recognises %s", (_name, error) => {
    expect(isSignatureRejection(error)).toBe(true);
    expect(thrownBy(error)).toEqual(new Error(SIGNATURE_CANCELLED_MESSAGE));
  });

  it("does not treat the other SEP-43 codes as a cancellation", () => {
    // -1 internal error, -2 external service error, -3 invalid request.
    for (const code of [-1, -2, -3, 0, 4, "-1", "-3", -4.5, "- 4", "-4 "]) {
      expect(isSignatureRejection({ message: "wallet failed", code }), String(code)).toBe(false);
    }
  });
});

describe("rejection wording without a code", () => {
  it.each([
    "The user rejected this request.",
    "User rejected the request.",
    "User declined access",
    "user denied transaction signature",
    "User cancelled the operation",
    "User canceled the operation",
    "Action request was rejected by the user.",
    "Transaction was declined by the user",
    "USER REJECTED THIS REQUEST",
  ])("recognises %j", (text) => {
    expect(isSignatureRejection(text)).toBe(true);
    expect(isSignatureRejection(new Error(text))).toBe(true);
    expect(isSignatureRejection({ message: text })).toBe(true);
  });

  it("finds the wording in a nested error", () => {
    expect(isSignatureRejection({ error: new Error("User declined access") })).toBe(true);
    expect(isSignatureRejection({ message: "failed", error: { message: "User denied it" } })).toBe(
      true,
    );
  });

  it("does not mistake network or contract failures for a cancellation", () => {
    for (const text of [
      'deposit rejected: {"result":"tx_failed"}',
      "Transaction rejected by the network",
      "Request rejected: rate limit",
      "The user does not have enough balance",
      "Wallet locked",
      "Error(Contract, #6)",
      "tx_bad_seq",
      "Account not found",
      "",
    ]) {
      expect(isSignatureRejection(text), text).toBe(false);
      expect(isSignatureRejection(new Error(text)), text).toBe(false);
    }
  });

  it("does not match a rejection verb that is only a prefix of a longer word", () => {
    expect(isSignatureRejection("user rejectedly")).toBe(false);
  });
});

describe("edge states", () => {
  it("is false for values that carry no error at all", () => {
    for (const value of [undefined, null, 0, 1, true, false, Symbol("x"), 10n, () => {}]) {
      expect(isSignatureRejection(value), String(typeof value)).toBe(false);
    }
  });

  it("is false for empty objects and arrays", () => {
    expect(isSignatureRejection({})).toBe(false);
    expect(isSignatureRejection([])).toBe(false);
    expect(isSignatureRejection({ message: "" })).toBe(false);
    expect(isSignatureRejection({ message: 42, code: "nope" })).toBe(false);
  });

  it("terminates on an error that points at itself", () => {
    const loop: { message: string; error?: unknown } = { message: "boom" };
    loop.error = loop;
    expect(isSignatureRejection(loop)).toBe(false);
  });

  it("terminates on a long cycle and gives up past the nesting limit", () => {
    const a: { message: string; error?: unknown } = { message: "a" };
    const b: { message: string; error?: unknown } = { message: "b", error: a };
    a.error = b;
    expect(isSignatureRejection(a)).toBe(false);

    // Four wrappers deep is past the limit: the code there is not read.
    const tooDeep = { error: { error: { error: { error: { code: -4 } } } } };
    expect(isSignatureRejection(tooDeep)).toBe(false);
  });
});

describe("translateSignatureError", () => {
  it("always throws, never returns", () => {
    expect(() => translateSignatureError(new Error("x"))).toThrow();
    expect(() => translateSignatureError({ code: -4 })).toThrow();
    expect(() => translateSignatureError(undefined)).toThrow();
  });

  it("replaces a cancellation with a plain Error carrying the friendly message", () => {
    const caught = thrownBy({ message: "Action request was rejected by the user.", code: -4 });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(SIGNATURE_CANCELLED_MESSAGE);
  });

  it("re-throws any other failure untouched, as the same object", () => {
    const failure = Object.assign(new Error("The wallet encountered an internal error."), {
      code: -1,
    });
    expect(thrownBy(failure)).toBe(failure);

    const network = new Error('deposit rejected: {"result":"tx_failed"}');
    expect(thrownBy(network)).toBe(network);
  });

  it("re-throws non-Error values as they were given", () => {
    const plain = { message: "Wallet locked", code: -2 };
    expect(thrownBy(plain)).toBe(plain);
    expect(thrownBy("boom")).toBe("boom");
    expect(thrownBy(undefined)).toBeUndefined();
  });

  it("does not translate its own friendly message a second time", () => {
    const friendly = new Error(SIGNATURE_CANCELLED_MESSAGE);
    expect(thrownBy(friendly)).toBe(friendly);
  });
});
