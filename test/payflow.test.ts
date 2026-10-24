import { describe, expect, it } from "vitest";
import { scValToNative } from "@stellar/stellar-sdk";
import {
  MAX_NAME_LEN,
  MAX_PAGE,
  arg,
  canSetMaxCharges,
  validateMaxCharges,
} from "@/lib/payflow";

/**
 * The typed wrappers in `payflow.ts` encode every contract argument through
 * `arg`. A wrong ScVal type is only caught by the network at submission time,
 * so these tests decode the encoded values back and check the SDK types the
 * contract expects — especially u64/i128, where a Number would lose precision.
 */

const ADDRESS = "GAEWDXVDI3WI35TWTZXNQ4NTRYIG6J34XPRSNKX655LBA377M5ZOCBY5";

describe("contract argument encoding", () => {
  it("encodes an address and decodes it back to the same StrKey", () => {
    expect(scValToNative(arg.address(ADDRESS))).toBe(ADDRESS);
  });

  it("encodes u64 as a bigint without losing precision", () => {
    const large = 9_007_199_954_740_993n; // Number.MAX_SAFE_INTEGER + 2
    const decoded = scValToNative(arg.u64(large));

    expect(decoded).toBe(large);
    expect(typeof decoded).toBe("bigint");
  });

  it("encodes u32 ids and periods as numbers", () => {
    expect(scValToNative(arg.u32(604_800))).toBe(604_800);
    expect(typeof scValToNative(arg.u32(604_800))).toBe("number");
  });

  it("encodes i128 amounts as bigint, never floating point", () => {
    const amount = 10_000_000n;
    const decoded = scValToNative(arg.i128(amount));

    expect(decoded).toBe(amount);
    expect(typeof decoded).toBe("bigint");
  });

  it("encodes booleans and UTF-8 plan names", () => {
    expect(scValToNative(arg.bool(true))).toBe(true);
    expect(scValToNative(arg.bool(false))).toBe(false);
    expect(scValToNative(arg.string("Pro Monthly"))).toBe("Pro Monthly");
    expect(scValToNative(arg.string("日本語プラン"))).toBe("日本語プラン");
  });
});

describe("contract limits", () => {
  it("matches the page size the contracts return", () => {
    expect(MAX_PAGE).toBe(50);
  });

  it("matches the plan-name byte limit", () => {
    expect(MAX_NAME_LEN).toBe(64);
  });
});

describe("canSetMaxCharges", () => {
  it("returns true when the contract exposes set_max_charges", () => {
    expect(canSetMaxCharges(["set_max_charges", "charge"])).toBe(true);
  });

  it("returns false when the function is missing or unknown", () => {
    expect(canSetMaxCharges([])).toBe(false);
    expect(canSetMaxCharges(["charge"])).toBe(false);
    expect(canSetMaxCharges(null)).toBe(false);
    expect(canSetMaxCharges(undefined)).toBe(false);
  });
});

describe("validateMaxCharges", () => {
  it("accepts a cap at or above the charges already made", () => {
    expect(validateMaxCharges({
      maxCharges: 5n,
      chargesMade: 2n,
      currentMaxCharges: 10n,
    })).toBeNull();
    expect(validateMaxCharges({
      maxCharges: 2n,
      chargesMade: 2n,
      currentMaxCharges: 10n,
    })).toBeNull();
  });

  it("rejects a cap below the charges already made", () => {
    expect(validateMaxCharges({
      maxCharges: 1n,
      chargesMade: 2n,
      currentMaxCharges: 10n,
    })).toMatch(/charges made/i);
  });

  it("rejects a cap that is not a positive integer", () => {
    expect(validateMaxCharges({
      maxCharges: 0n,
      chargesMade: 0n,
      currentMaxCharges: 10n,
    })).toMatch(/at least 1/i);
  });

  it("rejects a cap above the contract upper bound", () => {
    expect(validateMaxCharges({
      maxCharges: 6n,
      chargesMade: 0n,
      currentMaxCharges: 10n,
      maxAllowed: 5n,
    })).toMatch(/at most 5/i);
  });
});
