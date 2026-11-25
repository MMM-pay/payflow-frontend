import { describe, expect, it } from "vitest";
import {
  PERIODS_ERROR,
  amountForPeriods,
  depositCoverage,
  parseDepositPeriods,
  periodsForAmount,
  periodsToAmountText,
} from "@/lib/deposit-amount";

/**
 * Deposit coverage in periods or token units (issue #408). The two units are
 * one amount at the plan price, so every conversion is exact integer maths.
 */

const PRICE = 5_000_000n; // 0.5 XLM at 7 decimals

describe("periods and amounts", () => {
  it("reads a positive whole number of periods", () => {
    expect(parseDepositPeriods("3")).toBe(3);
    expect(parseDepositPeriods(" 12 ")).toBe(12);
    expect(parseDepositPeriods("0")).toBeNull();
    expect(parseDepositPeriods("2.5")).toBeNull();
    expect(parseDepositPeriods("")).toBeNull();
    expect(parseDepositPeriods("1e3")).toBeNull();
  });

  it("multiplies the plan price by the periods", () => {
    expect(amountForPeriods(3, PRICE)).toBe(15_000_000n);
    expect(amountForPeriods("4", PRICE)).toBe(20_000_000n);
    expect(amountForPeriods("nope", PRICE)).toBeNull();
    expect(amountForPeriods(3, 0n)).toBeNull();
  });

  it("rounds down to the whole periods an amount covers", () => {
    expect(periodsForAmount(15_000_000n, PRICE)).toBe(3);
    // Part of a period is not coverage, but it is still a valid deposit.
    expect(periodsForAmount(12_000_000n, PRICE)).toBe(2);
    expect(periodsForAmount(1n, PRICE)).toBe(0);
    expect(periodsForAmount(1n, 0n)).toBeNull();
  });

  it("formats the matching amount text for the other field", () => {
    expect(periodsToAmountText(2, PRICE, 7)).toBe("1");
    expect(periodsToAmountText(1, 1_234_567n, 7)).toBe("0.1234567");
  });
});

describe("depositCoverage", () => {
  it("accepts periods and returns the amount they fund", () => {
    expect(depositCoverage("periods", "3", PRICE, 7)).toEqual({
      periods: 3,
      amount: 15_000_000n,
      error: null,
    });
  });

  it("reports a periods draft that is not a whole number", () => {
    const result = depositCoverage("periods", "2.5", PRICE, 7);
    expect(result.amount).toBeNull();
    expect(result.error).toBe(PERIODS_ERROR);
  });

  it("accepts a raw amount and derives the periods it covers", () => {
    expect(depositCoverage("amount", "1.5", PRICE, 7, "en-GB")).toEqual({
      periods: 3,
      amount: 15_000_000n,
      error: null,
    });
  });

  it("reads a comma decimal in a French locale the same way", () => {
    expect(depositCoverage("amount", "1,5", PRICE, 7, "fr-FR").amount).toBe(15_000_000n);
  });

  it("refuses a malformed amount without throwing", () => {
    expect(depositCoverage("amount", "1.2.3", PRICE, 7).error).toBeTruthy();
    expect(depositCoverage("amount", "", PRICE, 7).error).toBeTruthy();
  });

  it("says so when a plan has no price to convert", () => {
    expect(depositCoverage("periods", "3", 0n, 7).error).toBe(
      "This plan has no price to cover.",
    );
  });
});
