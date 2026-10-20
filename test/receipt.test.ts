import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildReceiptData,
  formatReceiptDate,
  loadReceipt,
  parseReceiptParams,
} from "@/lib/receipt";
import type { ApiCharge, ApiMandate } from "@/lib/api";
import { XLM } from "@/lib/format";

describe("receipt pure functions", () => {
  describe("parseReceiptParams", () => {
    it("parses valid tx and mandate parameters", () => {
      const result = parseReceiptParams({
        tx: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        mandate: "42",
      });
      expect(result).toEqual({
        txHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        mandateId: 42,
        error: null,
      });
    });

    it("trims whitespace around tx and mandate parameters", () => {
      const result = parseReceiptParams({
        tx: "   tx_hash_123   ",
        mandate: "   7   ",
      });
      expect(result).toEqual({
        txHash: "tx_hash_123",
        mandateId: 7,
        error: null,
      });
    });

    it("rejects missing transaction hash", () => {
      const result = parseReceiptParams({ mandate: "7" });
      expect(result.txHash).toBeNull();
      expect(result.error).toContain("Missing transaction hash");
    });

    it("rejects missing mandate ID", () => {
      const result = parseReceiptParams({ tx: "tx_hash_123" });
      expect(result.mandateId).toBeNull();
      expect(result.error).toContain("Missing mandate ID");
    });

    it("rejects missing both parameters", () => {
      const result = parseReceiptParams({});
      expect(result.txHash).toBeNull();
      expect(result.mandateId).toBeNull();
      expect(result.error).toContain("Missing transaction hash");
    });

    it("rejects invalid non-integer mandate ID", () => {
      const result = parseReceiptParams({ tx: "tx123", mandate: "not-a-number" });
      expect(result.mandateId).toBeNull();
      expect(result.error).toContain("Invalid mandate ID");
    });

    it("rejects negative mandate ID", () => {
      const result = parseReceiptParams({ tx: "tx123", mandate: "-1" });
      expect(result.mandateId).toBeNull();
      expect(result.error).toContain("Invalid mandate ID");
    });
  });

  describe("formatReceiptDate", () => {
    it("formats epoch timestamp into readable UTC date and time", () => {
      // 2026-10-19T14:30:00Z
      const timestamp = Date.UTC(2026, 9, 19, 14, 30, 0);
      expect(formatReceiptDate(timestamp)).toBe("19 Oct 2026, 14:30 UTC");
    });

    it("returns dash for null, zero, negative, or invalid timestamps", () => {
      expect(formatReceiptDate(null)).toBe("—");
      expect(formatReceiptDate(0)).toBe("—");
      expect(formatReceiptDate(-1)).toBe("—");
      expect(formatReceiptDate(NaN)).toBe("—");
    });
  });

  describe("buildReceiptData", () => {
    const mockMandate: ApiMandate = {
      id: 5,
      subscriber: "GSUB1234567890",
      merchant: "GMER1234567890",
      plan_id: 2,
      amount: "10000000", // 1 XLM
      period: 2592000,
      next_charge: 1000,
      last_charge: 500,
      charges_made: 3,
      max_charges: 12,
      fee_bps: 200, // 2%
      status: "Active",
    };

    const mockCharge: ApiCharge = {
      tx_hash: "tx_mock_hash",
      mandate_id: 5,
      amount: "10000000",
      fee: "200000", // 2% fee = 0.02 XLM
      charges_made: 3,
      ledger: 123456,
    };

    it("builds receipt from API charge data with exact bigint amounts", () => {
      const timestamp = Date.UTC(2026, 9, 19, 12, 0, 0);
      const receipt = buildReceiptData(mockCharge, mockMandate, XLM, timestamp, "tx_mock_hash");

      expect(receipt.source).toBe("api");
      expect(receipt.mandateId).toBe(5);
      expect(receipt.planId).toBe(2);
      expect(receipt.subscriber).toBe("GSUB1234567890");
      expect(receipt.merchant).toBe("GMER1234567890");
      expect(receipt.gross).toBe(10_000_000n);
      expect(receipt.fee).toBe(200_000n);
      expect(receipt.net).toBe(9_800_000n);
      expect(receipt.chargeNumber).toBe(3);
      expect(receipt.totalCharges).toBe(12);
      expect(receipt.ledger).toBe(123456);
      expect(receipt.date).toBe("19 Oct 2026, 12:00 UTC");
    });

    it("builds receipt from on-chain mandate in contract-only mode without floating point math", () => {
      const timestamp = Date.UTC(2026, 9, 19, 12, 0, 0);
      const receipt = buildReceiptData(null, mockMandate, XLM, timestamp, "tx_fallback_hash");

      expect(receipt.source).toBe("contract-estimate");
      expect(receipt.gross).toBe(10_000_000n);
      // 10_000_000 * 200 / 10_000 = 200_000
      expect(receipt.fee).toBe(200_000n);
      expect(receipt.net).toBe(9_800_000n);
      expect(receipt.ledger).toBeNull();
    });
  });
});

describe("loadReceipt integration", () => {
  const apiMock = vi.hoisted(() => ({
    charges: vi.fn(),
    mandate: vi.fn(),
  }));

  const payflowMock = vi.hoisted(() => ({
    getMandate: vi.fn(),
  }));

  const serverMock = vi.hoisted(() => ({
    getTransaction: vi.fn(),
  }));

  vi.mock("@/lib/api", () => ({
    api: apiMock,
  }));

  vi.mock("@/lib/payflow", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/payflow")>();
    return {
      ...actual,
      payflow: payflowMock,
      server: serverMock,
    };
  });

  vi.mock("@/lib/token", () => ({
    loadTokenMeta: vi.fn().mockResolvedValue({ symbol: "XLM", decimals: 7 }),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads receipt successfully from API charge and contract mandate", async () => {
    apiMock.charges.mockResolvedValue({
      charges: [
        {
          tx_hash: "target_tx_hash",
          mandate_id: 1,
          amount: "50000000",
          fee: "500000",
          charges_made: 1,
          ledger: 9999,
        },
      ],
    });

    payflowMock.getMandate.mockResolvedValue({
      id: 1n,
      subscriber: "GSUB_TEST",
      merchant: "GMER_TEST",
      plan_id: 1n,
      amount: 50000000n,
      period: 86400n,
      next_charge: 1000n,
      last_charge: 500n,
      charges_made: 1,
      max_charges: 0,
      fee_bps: 100,
      status: ["Active"],
      token: "CTOKEN",
    });

    serverMock.getTransaction.mockResolvedValue({
      createdAt: 1700000000,
    });

    const res = await loadReceipt(1, "target_tx_hash");
    expect(res.error).toBeNull();
    expect(res.apiAvailable).toBe(true);
    expect(res.receipt).not.toBeNull();
    expect(res.receipt?.gross).toBe(50_000_000n);
    expect(res.receipt?.fee).toBe(500_000n);
    expect(res.receipt?.net).toBe(49_500_000n);
    expect(res.receipt?.subscriber).toBe("GSUB_TEST");
    expect(res.receipt?.merchant).toBe("GMER_TEST");
  });

  it("handles contract-only mode when API is unavailable", async () => {
    // API returns null (offline or contract-only mode)
    apiMock.charges.mockResolvedValue(null);

    payflowMock.getMandate.mockResolvedValue({
      id: 2n,
      subscriber: "GSUB_OFFLINE",
      merchant: "GMER_OFFLINE",
      plan_id: 1n,
      amount: 20000000n,
      period: 604800n,
      next_charge: 2000n,
      last_charge: 1000n,
      charges_made: 2,
      max_charges: 10,
      fee_bps: 100,
      status: ["Active"],
      token: "CTOKEN",
    });

    serverMock.getTransaction.mockResolvedValue({
      createdAt: 1700000000,
    });

    const res = await loadReceipt(2, "tx_offline");
    expect(res.error).toBeNull();
    expect(res.apiAvailable).toBe(false);
    expect(res.receipt?.source).toBe("contract-estimate");
    expect(res.receipt?.gross).toBe(20_000_000n);
    expect(res.receipt?.subscriber).toBe("GSUB_OFFLINE");
  });

  it("returns an error when the mandate cannot be found", async () => {
    apiMock.charges.mockResolvedValue(null);
    payflowMock.getMandate.mockRejectedValue(new Error("Mandate not found"));
    apiMock.mandate.mockResolvedValue(null);

    const res = await loadReceipt(999, "tx_missing");
    expect(res.receipt).toBeNull();
    expect(res.error).toContain("Mandate #999 could not be found");
  });
});
