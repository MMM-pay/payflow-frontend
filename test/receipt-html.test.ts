import { describe, expect, it } from "vitest";
import { buildReceiptHtml, escapeReceiptHtml } from "@/lib/receipt-html";
import { receiptFilename, type ReceiptData } from "@/lib/receipt";
import type { TokenMeta } from "@/lib/format";

const meta: TokenMeta = { symbol: "USDC", decimals: 6 };

function receipt(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    txHash: "abcdef1234567890",
    mandateId: 7,
    date: "2 Jan 2026, 00:05 UTC",
    timestamp: 1767312300000,
    subscriber: "GSUBSCRIBER",
    merchant: "GMERCHANT",
    gross: 50_000_000n,
    fee: 500_000n,
    net: 49_500_000n,
    tokenMeta: meta,
    chargeNumber: 3,
    totalCharges: 12,
    ledger: 100,
    period: 2_592_000,
    planId: 2,
    source: "api",
    ...overrides,
  };
}

describe("downloadable receipt (#296)", () => {
  it("builds a complete, self-contained HTML document", () => {
    const html = buildReceiptHtml(receipt());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Payflow receipt — mandate 7");
    expect(html).toContain("50 USDC");
    expect(html).toContain("0.5 USDC");
    expect(html).toContain("49.5 USDC");
    expect(html).toContain("Charge 3 of 12");
    expect(html).toContain("Ledger #100");
    expect(html).toContain("abcdef1234567890");
    expect(html).toContain("GMERCHANT");
    expect(html).not.toContain("<script");
  });

  it("uses the token's own decimals rather than display rounding", () => {
    const html = buildReceiptHtml(
      receipt({
        tokenMeta: { symbol: "XLM", decimals: 7 },
        gross: 12_345_678n,
        fee: 123_456n,
        net: 12_222_222n,
      }),
    );
    expect(html).toContain("1.2345678 XLM");
    expect(html).toContain("0.0123456 XLM");
    expect(html).toContain("1.2222222 XLM");
  });

  it("escapes text that could break the document", () => {
    expect(escapeReceiptHtml(`<b>"x" & 'y'</b>`)).toBe(
      "&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;",
    );
    const html = buildReceiptHtml(
      receipt({ merchant: '<img src=x onerror="alert(1)">' }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("names the file after the mandate and transaction", () => {
    expect(receiptFilename(receipt())).toBe("payflow-receipt-7-abcdef12.html");
  });
});
