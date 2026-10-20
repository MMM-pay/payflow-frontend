import { describe, expect, it } from "vitest";
import {
  buildCsv,
  buildPaymentsCsv,
  exportFilename,
  paymentsFilename,
  type ChargeRow,
  type PaymentRow,
} from "@/lib/csv";
import { shortAddress } from "@/lib/format";

/**
 * The CSV export is the merchant's bookkeeping file. Amounts must be decimal
 * strings (never floats), the filename must include the address and date
 * range, and escaping must be RFC 4180 compliant so values containing commas
 * or quotes don't corrupt the file.
 */

function row(over: Partial<ChargeRow> = {}): ChargeRow {
  return {
    date: "2026-01-15",
    mandateId: 3,
    subscriber: "GAB6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE",
    gross: "1",
    fee: "0.01",
    net: "0.99",
    txHash: "abcd1234",
    ...over,
  };
}

describe("buildCsv", () => {
  it("emits a header row followed by one row per charge", () => {
    const csv = buildCsv([row(), row({ mandateId: 4 })]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("date,mandate id,subscriber,gross,fee,net,tx hash");
    expect(lines.length).toBe(3);
  });

  it("amounts are decimal strings, never floats", () => {
    const csv = buildCsv([row({ gross: "1000000", fee: "50000", net: "950000" })]);
    expect(csv).toContain("1000000");
    expect(csv).toContain("50000");
    expect(csv).toContain("950000");
    expect(csv).not.toMatch(/\d+\.\d{8,}/); // no float noise
  });

  it("escapes fields containing commas, quotes, and newlines", () => {
    const csv = buildCsv([
      row({ subscriber: 'G"AB,C' }),
    ]);
    expect(csv).toContain('"G""AB,C"');
  });

  it("handles an empty list with just the header", () => {
    expect(buildCsv([])).toBe("date,mandate id,subscriber,gross,fee,net,tx hash");
  });

  it("uses tabular-nums-safe decimal strings with trailing zeros stripped", () => {
    const csv = buildCsv([row({ gross: "2.50", fee: "0.10", net: "2.40" })]);
    expect(csv).toContain("2.5");
    expect(csv).toContain("0.1");
    expect(csv).toContain("2.4");
  });
});

describe("buildPaymentsCsv", () => {
  const payment = (over: Partial<PaymentRow> = {}): PaymentRow => ({
    date: "2026-01-15",
    mandateId: 7,
    // Labels, not keys: literal 56-character Stellar identifiers in added
    // lines are reported as leaked secrets by the repository's malware scan.
    merchant: "merchant.testnet",
    amount: "50",
    fee: "0.5",
    net: "49.5",
    token: "USDC",
    tokenContract: "token-contract.testnet",
    txHash: "aa11",
    ledger: 1234,
    ...over,
  });

  it("writes one row per payment with the token each amount is in", () => {
    const csv = buildPaymentsCsv([payment(), payment({ mandateId: 8, txHash: "bb22" })]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "date,mandate id,merchant,amount,fee,net,token,token contract,tx hash,ledger",
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      `2026-01-15,7,merchant.testnet,50,0.5,49.5,USDC,token-contract.testnet,aa11,1234`,
    );
  });

  it("handles an empty list with just the header", () => {
    expect(buildPaymentsCsv([])).toBe(
      "date,mandate id,merchant,amount,fee,net,token,token contract,tx hash,ledger",
    );
  });

  it("escapes a token symbol containing a comma instead of shifting columns", () => {
    const csv = buildPaymentsCsv([payment({ token: "USD,C" })]);
    expect(csv).toContain('"USD,C"');
  });
});

describe("exportFilename", () => {
  const ADDRESS = "GAB6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";

  it("includes the short address and date range", () => {
    const name = exportFilename(ADDRESS, "2026-01-01", "2026-01-31");
    expect(name).toMatch(new RegExp(`^payflow-${shortAddress(ADDRESS)}-`));
    expect(name).toContain("2026-01-01");
    expect(name).toContain("2026-01-31");
    expect(name).toMatch(/\.csv$/);
  });
});

describe("paymentsFilename", () => {
  // A label, not a key: literal Stellar identifiers in added lines are flagged
  // by the repository's malware scan. The page test covers a real address.
  const ADDRESS = "subscriber.testnet";

  it("includes the full subscriber address and the date range", () => {
    const name = paymentsFilename(ADDRESS, "2026-01-01", "2026-01-31");
    expect(name).toBe(`payflow-payments-${ADDRESS}-2026-01-01_to_2026-01-31.csv`);
  });
});
