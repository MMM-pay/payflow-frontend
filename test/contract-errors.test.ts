import { describe, expect, it } from "vitest";
import {
  CALLEE_ERRORS,
  CONTRACT_ERROR_CODES,
  contractErrorMessage,
  SIGNATURE_CANCELLED_MESSAGE,
  decodeContractError,
  isSignatureRejection,
  nameByteLength,
} from "@/lib/payflow";

/**
 * Soroban surfaces failures as `Error(Contract, #N)`, where the code is scoped to the
 * contract that raised it. Mapping a code to the wrong sentence tells a user the
 * wrong reason their payment failed, so the scoping is tested per method.
 */

const err = (code: number) => new Error(`HostError: Error(Contract, #${code})`);

describe("decodeContractError", () => {
  it("scopes code 4 to the vault for balance methods", () => {
    expect(decodeContractError(err(4), "withdraw")).toMatch(/balance in your vault/i);
    expect(decodeContractError(err(4), "deposit")).toMatch(/balance in your vault/i);
  });

  it("scopes code 4 to the subscription for mandate methods", () => {
    // Same number, different contract: here it means wrong caller.
    expect(decodeContractError(err(4), "cancel")).toMatch(/not the subscriber/i);
  });

  it("reads a vault failure inside charge as a balance problem", () => {
    // charge never returns its own #4; a #4 there comes from vault.debit.
    expect(decodeContractError(err(4), "charge")).toMatch(/does not hold enough/i);
    expect(decodeContractError(err(4), "charge")).not.toMatch(/not the subscriber/i);
  });

  it("reads a registry failure inside subscribe as a missing plan", () => {
    expect(decodeContractError(err(3), "subscribe")).toMatch(/plan does not exist/i);
  });

  it("explains a non-merchant trying to end a mandate", () => {
    expect(decodeContractError(err(11), "end_mandate")).toMatch(/only the merchant/i);
  });

  it("scopes code 4 to the registry for plan methods", () => {
    expect(decodeContractError(err(4), "set_plan_active")).toMatch(/do not own that plan/i);
  });

  it("explains the common subscription failures in plain language", () => {
    expect(decodeContractError(err(6), "charge")).toMatch(/not due yet/i);
    expect(decodeContractError(err(7), "subscribe")).toMatch(/no longer accepting/i);
    expect(decodeContractError(err(5), "charge")).toMatch(/not active/i);
    expect(decodeContractError(err(9), "charge")).toMatch(/charge limit/i);
  });

  it("explains registry validation failures", () => {
    expect(decodeContractError(err(5), "create_plan")).toMatch(/greater than zero/i);
    expect(decodeContractError(err(6), "create_plan")).toMatch(/at least 60 seconds/i);
  });

  it("names the code when it has no mapping, rather than hiding it", () => {
    const out = decodeContractError(err(99), "charge");
    expect(out).toContain("#99");
    expect(out).toContain("charge");
  });

  it("translates a missing testnet account into an actionable instruction", () => {
    expect(decodeContractError(new Error("Account not found: GABC"), "deposit")).toMatch(
      /Friendbot/,
    );
  });

  it("passes through messages that carry no contract code", () => {
    expect(decodeContractError(new Error("network unreachable"), "charge")).toBe(
      "network unreachable",
    );
  });

  it("does not treat a network rejection as a cancelled signature", () => {
    const network = new Error('deposit rejected: {"result":"tx_failed"}');
    expect(isSignatureRejection(network)).toBe(false);
    expect(decodeContractError(network, "deposit")).toBe(network.message);
  });

  it("accepts a bare string as well as an Error", () => {
    expect(decodeContractError("Error(Contract, #6)", "charge")).toMatch(/not due yet/i);
  });

  it("never returns an empty string", () => {
    for (const input of [undefined, null, "", {}]) {
      expect(decodeContractError(input, "charge").length).toBeGreaterThan(0);
    }
  });
});

describe("wallet signature rejection", () => {
  // Freighter (SEP-43) throws an Error whose message is the raw wallet text.
  // https://docs.freighter.app/extension-freighter-api/signing
  const freighter = new Error("The user rejected this request.");

  // Albedo rejects with a plain object, not an Error.
  // @albedo-link/intent `actionRejectedByUser`.
  const albedo = {
    message: "Action request was rejected by the user.",
    code: -4,
  };

  it("maps Freighter's rejection text to the friendly message", () => {
    expect(isSignatureRejection(freighter)).toBe(true);
    expect(decodeContractError(freighter, "subscribe")).toBe(SIGNATURE_CANCELLED_MESSAGE);
  });

  it("maps Albedo's rejection object to the friendly message", () => {
    expect(isSignatureRejection(albedo)).toBe(true);
    expect(decodeContractError(albedo, "deposit")).toBe(SIGNATURE_CANCELLED_MESSAGE);
  });

  it("maps a nested Freighter error payload that only carries code -4", () => {
    const nested = { error: { message: "Cancelled", code: -4 } };
    expect(isSignatureRejection(nested)).toBe(true);
    expect(decodeContractError(nested, "charge")).toBe(SIGNATURE_CANCELLED_MESSAGE);
  });

  it("maps an older Freighter decline string", () => {
    expect(isSignatureRejection("User declined access")).toBe(true);
    expect(decodeContractError("User declined access", "withdraw")).toBe(
      SIGNATURE_CANCELLED_MESSAGE,
    );
  });

  it("does not treat the friendly message itself as another rejection", () => {
    expect(isSignatureRejection(new Error(SIGNATURE_CANCELLED_MESSAGE))).toBe(false);
  });

  it("leaves a wallet failure that is not a cancellation alone", () => {
    const internal = Object.assign(
      new Error("The wallet encountered an internal error. Please try again."),
      { code: -1 },
    );
    expect(isSignatureRejection(internal)).toBe(false);
    expect(decodeContractError(internal, "withdraw")).toBe(internal.message);
  });
});

describe("plan name validation", () => {
  it("explains an over-long plan name", () => {
    expect(decodeContractError(err(7), "create_plan")).toMatch(/name is too long/i);
  });

  it("does not confuse registry #7 with the subscription's #7", () => {
    // Same code, different contract: inactive plan vs. name too long.
    expect(decodeContractError(err(7), "subscribe")).toMatch(/no longer accepting/i);
  });
});

describe("every known contract error code", () => {
  // Mirrors CONTRACT_ERRORS and CALLEE_ERRORS in src/lib/payflow.ts. A code that is
  // added to the contract but missed here reaches the UI as
  // "Error(Contract, #N)", so keep this table in sync with that map.
  const cases: Array<[method: string, code: number, message: string]> = [
    // plan_registry
    ["create_plan", 3, "That plan does not exist."],
    ["set_plan_active", 4, "You do not own that plan."],
    ["create_plan", 5, "Amount must be greater than zero."],
    ["create_plan", 6, "Billing period must be at least 60 seconds."],
    ["create_plan", 7, "That plan name is too long."],
    // vault
    ["deposit", 3, "Amount must be greater than zero."],
    ["withdraw", 4, "Not enough balance in your vault."],
    ["deposit", 5, "The vault is not wired to a subscription contract yet."],
    // subscription
    ["cancel", 3, "That subscription does not exist."],
    ["cancel", 4, "You are not the subscriber on this mandate."],
    ["charge", 5, "This subscription is not active."],
    ["charge", 6, "This subscription is not due yet."],
    ["subscribe", 7, "That plan is no longer accepting subscribers."],
    ["charge", 9, "This subscription has reached its charge limit."],
    ["end_mandate", 11, "Only the merchant on this subscription can end it."],
    // callee codes raised through a cross-contract call
    ["charge", 4, "The subscriber's vault does not hold enough to cover this charge."],
    ["subscribe", 3, "That plan does not exist."],
  ];

  it.each(cases)("%s maps code #%i to a readable message", (method, code, message) => {
    expect(decodeContractError(err(code), method)).toBe(message);
  });

  // The table above is only as good as the map it mirrors. This checks the
  // map itself, so a new contract error that is added to CONTRACT_ERRORS without
  // a sentence (or with a generic "\"Error(Contract, #N)\"" string) fails the test.
  const genericMessage = /Error\(Contract, #\d+\)/i;

  it("gives every contract error a non-generic sentence", () => {
    for (const [contract, codes] of Object.entries(CONTRACT_ERROR_CODES)) {
      for (const code of codes) {
        const message = contractErrorMessage(contract, code);
        expect(message, `${contract} #${code} has no sentence`).toBeTypeOf("string");
        expect(message!.trim().length, `${contract} #${code} is empty`).toBeGreaterThan(0);
        expect(message, `${contract} #${code} is generic`).not.toMatch(genericMessage);
      }
    }
  });

  it("gives every callee error a non-generic sentence", () => {
    for (const [method, codes] of Object.entries(CALLEE_ERRORS)) {
      for (const [code, message] of Object.entries(codes)) {
        expect(message.trim().length, `${method} #${code} is empty`).toBeGreaterThan(0);
        expect(message, `${method} #${code} is generic`).not.toMatch(genericMessage);
      }
    }
  });
});

describe("nameByteLength", () => {
  it("counts ASCII as one byte per character", () => {
    expect(nameByteLength("Pro Monthly")).toBe(11);
  });

  it("counts multi-byte characters by their encoded length", () => {
    // The contract's limit is in bytes, so a 20-character name can exceed a
    // 64-byte cap. Measuring with String.length would wrongly let it through.
    expect(nameByteLength("日本語プラン")).toBe(18);
    expect("日本語プラン".length).toBe(6);
  });

  it("treats an emoji as more than one byte", () => {
    expect(nameByteLength("😀")).toBeGreaterThan(1);
  });
});
