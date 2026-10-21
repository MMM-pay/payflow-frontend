import { describe, expect, it, beforeEach } from "vitest";
import {
  formatUsdEstimate,
  formatUsdcEstimate,
  getReflectorOracleId,
  REFLECTOR_TESTNET_ORACLE,
  clearPriceCache,
} from "@/lib/price";

describe("formatUsdEstimate", () => {
  const ORACLE_DECIMALS = 14;
  // 18157275929256n with 14 decimals = ~$0.18157 per XLM
  const XLM_PRICE = 18_157_275_929_256n;

  it("formats zero amount as $0.00", () => {
    expect(formatUsdEstimate(0n, XLM_PRICE, ORACLE_DECIMALS, 7)).toBe("$0.00");
    expect(formatUsdEstimate(-100n, XLM_PRICE, ORACLE_DECIMALS, 7)).toBe("$0.00");
  });

  it("formats amounts under 1 cent as < $0.01", () => {
    // 0.01 XLM = 100,000 stroops * 0.18157 = $0.0018157
    expect(formatUsdEstimate(100_000n, XLM_PRICE, ORACLE_DECIMALS, 7)).toBe("< $0.01");
  });

  it("calculates accurate USD value for 10 XLM in bigint stroops", () => {
    // 10 XLM = 100_000_000 stroops * 0.18157275929256 = $1.8157... -> rounds to $1.82
    const res = formatUsdEstimate(100_000_000n, XLM_PRICE, ORACLE_DECIMALS, 7);
    expect(res).toBe("$1.82");
  });

  it("calculates accurate USD value for 100 XLM", () => {
    // 100 XLM = 1_000_000_000 stroops -> $18.16
    const res = formatUsdEstimate(1_000_000_000n, XLM_PRICE, ORACLE_DECIMALS, 7);
    expect(res).toBe("$18.16");
  });

  it("handles string and number inputs safely", () => {
    expect(formatUsdEstimate("100000000", XLM_PRICE, ORACLE_DECIMALS, 7)).toBe("$1.82");
    expect(formatUsdEstimate(100000000, XLM_PRICE, ORACLE_DECIMALS, 7)).toBe("$1.82");
  });

  it("returns $0.00 when oracle price is zero or negative", () => {
    expect(formatUsdEstimate(100_000_000n, 0n, ORACLE_DECIMALS, 7)).toBe("$0.00");
  });
});

describe("formatUsdcEstimate", () => {
  it("formats USDC amounts with 6 decimals into USD", () => {
    // 1 USDC = 1_000_000 stroops
    expect(formatUsdcEstimate(1_000_000n, 6)).toBe("$1.00");
    expect(formatUsdcEstimate(15_500_000n, 6)).toBe("$15.50");
    expect(formatUsdcEstimate(100n, 6)).toBe("< $0.01");
    expect(formatUsdcEstimate(0n, 6)).toBe("$0.00");
  });
});

describe("getReflectorOracleId", () => {
  beforeEach(() => {
    clearPriceCache();
  });

  it("resolves to testnet reflector oracle by default", () => {
    const id = getReflectorOracleId();
    expect(id).toBe(REFLECTOR_TESTNET_ORACLE);
    expect(id).toMatch(/^C[A-Z0-9]{55}$/);
  });
});
