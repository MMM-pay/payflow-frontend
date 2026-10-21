import { describe, expect, it } from "vitest";
import type { ApiCharge, ApiMandate } from "@/lib/api";
import type { PaymentRow } from "@/lib/csv";
import {
  createdAtDate,
  exactAmount,
  paymentDateRange,
  paymentRow,
  sortPaymentsNewestFirst,
} from "@/lib/payments";

/**
 * The subscriber's payment export is a financial record: an accountant reads
 * the amounts, and the subscriber may use the file to claim expenses or file
 * taxes. Every amount must therefore keep the token's own scale and every digit
 * the token can represent, with no floating point anywhere in the conversion.
 */

// Labels, not keys. Literal 56-character Stellar identifiers in added lines
// trip the repository's gitleaks-based malware scan as generic API keys.
const MERCHANT = "merchant.testnet";
const TOKEN = "token-contract.testnet";

function mandate(over: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 7,
    subscriber: "subscriber.testnet",
    merchant: MERCHANT,
    plan_id: 1,
    amount: "10000000",
    period: 2_592_000,
    next_charge: 0,
    last_charge: 0,
    charges_made: 1,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
    ended_by: null,
    ...over,
  };
}

function charge(over: Partial<ApiCharge> = {}): ApiCharge {
  return {
    tx_hash: "aa11",
    mandate_id: 7,
    amount: "10000000",
    fee: "100000",
    charges_made: 1,
    ledger: 100,
    ...over,
  };
}

function row(over: Partial<PaymentRow> = {}): PaymentRow {
  return {
    date: "2026-01-15",
    mandateId: 7,
    merchant: MERCHANT,
    amount: "1",
    fee: "0.01",
    net: "0.99",
    token: "XLM",
    tokenContract: TOKEN,
    txHash: "aa11",
    ledger: 100,
    ...over,
  };
}

describe("exactAmount", () => {
  it("scales 7-decimal stroops exactly, keeping every digit", () => {
    expect(exactAmount("10000000", 7)).toBe("1");
    expect(exactAmount("1", 7)).toBe("0.0000001");
    expect(exactAmount("123456789", 7)).toBe("12.3456789");
  });

  it("uses the token's own decimals instead of assuming XLM's 7", () => {
    // A 6-decimal token: this is the #30 bug. Dividing by 10^7 would report
    // 5 USDC as 0.5, a tenfold understatement of what the subscriber paid.
    expect(exactAmount("50000000", 6)).toBe("50");
    expect(exactAmount("1234567", 6)).toBe("1.234567");
    expect(exactAmount("1", 6)).toBe("0.000001");
  });

  it("handles zero-decimal tokens", () => {
    expect(exactAmount("42", 0)).toBe("42");
    expect(exactAmount("0", 0)).toBe("0");
  });

  it("keeps amounts beyond Number's safe integer range exact", () => {
    // 9,007,199,254,740,993 stroops is one above Number.MAX_SAFE_INTEGER.
    // A float round-trip would silently change the last digit.
    expect(exactAmount("9007199254740993", 7)).toBe("900719925.4740993");
  });
});

describe("paymentRow", () => {
  it("converts gross, fee and net in the token's scale", () => {
    const usdc = { symbol: "USDC", decimals: 6 };
    const result = paymentRow(
      charge({ amount: "50000000", fee: "500000" }),
      mandate(),
      usdc,
      TOKEN,
      "2026-01-15",
    );

    expect(result.amount).toBe("50");
    expect(result.fee).toBe("0.5");
    expect(result.net).toBe("49.5");
    expect(result.token).toBe("USDC");
    expect(result.tokenContract).toBe(TOKEN);
    expect(result.merchant).toBe(MERCHANT);
    expect(result.mandateId).toBe(7);
    expect(result.date).toBe("2026-01-15");
  });

  it("computes net in bigint, not as a float percentage", () => {
    const result = paymentRow(
      charge({ amount: "9999999", fee: "333" }),
      mandate(),
      { symbol: "XLM", decimals: 7 },
      TOKEN,
      "—",
    );
    expect(result.amount).toBe("0.9999999");
    expect(result.fee).toBe("0.0000333");
    expect(result.net).toBe("0.9999666");
  });

  it("rejects a malformed amount instead of exporting a zero", () => {
    expect(() =>
      paymentRow(
        charge({ amount: "1.5" }),
        mandate(),
        { symbol: "XLM", decimals: 7 },
        TOKEN,
        "—",
      ),
    ).toThrow(/Could not read the amount of payment aa11/);
  });
});

describe("sortPaymentsNewestFirst", () => {
  it("orders by date, then by ledger, newest first", () => {
    const rows = [
      row({ date: "2026-01-10", ledger: 1, txHash: "a" }),
      row({ date: "2026-02-01", ledger: 2, txHash: "b" }),
      row({ date: "2026-01-10", ledger: 5, txHash: "c" }),
    ];
    expect(sortPaymentsNewestFirst(rows).map((r) => r.txHash)).toEqual(["b", "c", "a"]);
    // The input is left untouched.
    expect(rows.map((r) => r.txHash)).toEqual(["a", "b", "c"]);
  });

  it("puts undated rows last rather than at the top", () => {
    const rows = [
      row({ date: "—", ledger: 99, txHash: "undated" }),
      row({ date: "2026-01-01", ledger: 1, txHash: "dated" }),
    ];
    expect(sortPaymentsNewestFirst(rows).map((r) => r.txHash)).toEqual([
      "dated",
      "undated",
    ]);
  });
});

describe("paymentDateRange", () => {
  it("uses the oldest and newest real dates", () => {
    const rows = [
      row({ date: "2026-03-31" }),
      row({ date: "2026-01-02" }),
      row({ date: "—" }),
    ];
    expect(paymentDateRange(rows)).toEqual({ from: "2026-01-02", to: "2026-03-31" });
  });

  it("names an undated export for the day it was produced", () => {
    const today = new Date("2026-10-20T12:00:00Z");
    expect(paymentDateRange([row({ date: "—" })], today)).toEqual({
      from: "2026-10-20",
      to: "2026-10-20",
    });
    expect(paymentDateRange([], today)).toEqual({ from: "2026-10-20", to: "2026-10-20" });
  });
});

describe("createdAtDate", () => {
  it("accepts seconds and milliseconds and returns a UTC date", () => {
    expect(createdAtDate(1767225600)).toBe("2026-01-01");
    expect(createdAtDate(1767225600000)).toBe("2026-01-01");
  });

  it("accepts the decimal string RPC serialises a u64 into", () => {
    // Soroban RPC returns `createdAt` as `"1767225600"`, not a number; treating
    // that as unreadable would blank the date on every real export.
    expect(createdAtDate("1767225600")).toBe("2026-01-01");
    expect(createdAtDate("1767225600000")).toBe("2026-01-01");
  });

  it("returns a visible dash rather than inventing a date", () => {
    expect(createdAtDate(0)).toBe("—");
    expect(createdAtDate(undefined)).toBe("—");
    expect(createdAtDate(Number.NaN)).toBe("—");
    expect(createdAtDate("2026-01-01")).toBe("—");
  });
});
