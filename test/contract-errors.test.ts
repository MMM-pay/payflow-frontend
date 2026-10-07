import { describe, expect, it } from "vitest";
import { decodeContractError } from "@/lib/payflow";

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
