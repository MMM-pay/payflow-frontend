import { describe, expect, it } from "vitest";
import { decodeContractError, nameByteLength } from "@/lib/payflow";

/**
 * Soroban surfaces failures as `Error(Contract, #N)`, where N is scoped to the
 * contract that raised it — so the same number means different things in
 * different contracts. Mapping a code to the wrong sentence tells a user the
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

  it("accepts a bare string as well as an Error", () => {
    expect(decodeContractError("Error(Contract, #6)", "charge")).toMatch(/not due yet/i);
  });

  it("never returns an empty string", () => {
    for (const input of [undefined, null, "", {}]) {
      expect(decodeContractError(input, "charge").length).toBeGreaterThan(0);
    }
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
    expect(nameByteLength("🚀")).toBeGreaterThan(1);
  });
});
