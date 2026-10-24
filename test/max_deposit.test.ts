import { describe, it, expect } from "vitest";
import { maxDeposit } from "../src/lib/format";

describe("maxDeposit", () => {
  it("reserves fees and base reserves correctly", () => {
    // 10 XLM (100_000_000 stroops)
    // Reserve for 0 subentries: (10M / 2) * 2 + 10M = 10M + 10M = 20M stroops (2 XLM)
    const balance = 100_000_000n;
    const max = maxDeposit(balance, 0);
    expect(max).toBe(80_000_000n);
  });

  it("accounts for subentries", () => {
    // 10 XLM, 2 subentries
    // Reserve: (10M / 2) * (2 + 2) + 10M = 20M + 10M = 30M stroops
    const balance = 100_000_000n;
    const max = maxDeposit(balance, 2);
    expect(max).toBe(70_000_000n);
  });

  it("returns 0 if balance is too low", () => {
    const balance = 5_000_000n; // 0.5 XLM
    const max = maxDeposit(balance, 0);
    expect(max).toBe(0n);
  });
});
