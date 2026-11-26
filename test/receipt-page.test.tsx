// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ReceiptPage from "@/app/receipt/page";
import type { ReceiptData } from "@/lib/receipt";
import { XLM } from "@/lib/format";

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

const receiptMock = vi.hoisted(() => ({
  loadReceipt: vi.fn(),
}));
const clipboardMock = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

vi.mock("@/lib/receipt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/receipt")>();
  return {
    ...actual,
    loadReceipt: receiptMock.loadReceipt,
  };
});
vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: clipboardMock.copyToClipboard,
}));

describe("ReceiptPage component", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    receiptMock.loadReceipt.mockReset();
    clipboardMock.copyToClipboard.mockReset();
  });

  afterEach(cleanup);

  it("displays error notice when parameters are missing", async () => {
    // No query params
    render(<ReceiptPage />);

    expect(await screen.findByText(/Could not load receipt/i)).toBeTruthy();
    expect(
      screen.getByText(/Missing transaction hash \(\?tx=…\) and mandate ID \(\?mandate=…\)/i),
    ).toBeTruthy();
  });

  it("displays error notice when mandate parameter is missing", async () => {
    mockSearchParams = new URLSearchParams({ tx: "abc1234" });
    render(<ReceiptPage />);

    expect(await screen.findByText(/Could not load receipt/i)).toBeTruthy();
    expect(screen.getByText(/Missing mandate ID \(\?mandate=…\)/i)).toBeTruthy();
  });

  it("renders receipt details correctly when data loads from API", async () => {
    mockSearchParams = new URLSearchParams({
      tx: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      mandate: "7",
    });

    const mockData: ReceiptData = {
      txHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      mandateId: 7,
      date: "19 Oct 2026, 14:30 UTC",
      timestamp: 1700000000000,
      subscriber: "GA_SUBSCRIBER_12345",
      merchant: "GB_MERCHANT_67890",
      gross: 25_000_000n, // 2.5 XLM
      fee: 250_000n, // 0.025 XLM
      net: 24_750_000n, // 2.475 XLM
      tokenMeta: XLM,
      chargeNumber: 1,
      totalCharges: 12,
      ledger: 54321,
      period: 2592000,
      planId: 3,
      source: "api",
    };

    receiptMock.loadReceipt.mockResolvedValue({
      receipt: mockData,
      apiAvailable: true,
      error: null,
    });

    render(<ReceiptPage />);

    // Header & status
    expect(await screen.findByText("Payment Receipt")).toBeTruthy();
    expect(screen.getByText("Settled")).toBeTruthy();
    expect(screen.getByText("Mandate #7 · Plan #3")).toBeTruthy();
    expect(screen.getByText("19 Oct 2026, 14:30 UTC")).toBeTruthy();

    // Charge sequence
    expect(screen.getByText(/Charge 1 of 12 · Ledger #54321/)).toBeTruthy();

    // Amounts
    const amounts = screen.getAllByTestId("money-amount").map((amount) => amount.getAttribute("aria-label"));
    expect(amounts.filter((amount) => amount === "2.5 XLM")).toHaveLength(2);
    expect(amounts).toContain("minus 0.025 XLM");
    expect(amounts).toContain("2.475 XLM");

    // Print button
    const printBtn = screen.getByRole("button", { name: /Print this receipt/i });
    expect(printBtn).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share this receipt" })).toBeTruthy();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    fireEvent.click(printBtn);
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();

    // No contract-only warning when API is available
    expect(screen.queryByText(/Contract-only mode/i)).toBeNull();
  });

  it("displays contract-only mode explanation when API is unavailable", async () => {
    mockSearchParams = new URLSearchParams({
      tx: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      mandate: "7",
    });

    const mockData: ReceiptData = {
      txHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      mandateId: 7,
      date: "19 Oct 2026, 14:30 UTC",
      timestamp: 1700000000000,
      subscriber: "GA_SUBSCRIBER_12345",
      merchant: "GB_MERCHANT_67890",
      gross: 25_000_000n,
      fee: 250_000n,
      net: 24_750_000n,
      tokenMeta: XLM,
      chargeNumber: 1,
      totalCharges: null,
      ledger: null,
      period: 2592000,
      planId: 3,
      source: "contract-estimate",
    };

    receiptMock.loadReceipt.mockResolvedValue({
      receipt: mockData,
      apiAvailable: false,
      error: null,
    });

    render(<ReceiptPage />);

    expect(await screen.findByText("Payment Receipt")).toBeTruthy();
    // Explanation notice for contract-only mode
    expect(screen.getByText(/Contract-only mode:/i)).toBeTruthy();
    expect(
      screen.getByText(/Detailed historical charge logs require the indexer API/i),
    ).toBeTruthy();
  });

  it("copies a shareable receipt URL and announces success", async () => {
    const txHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    mockSearchParams = new URLSearchParams({ tx: txHash, mandate: "7" });
    receiptMock.loadReceipt.mockResolvedValue({
      receipt: {
        txHash,
        mandateId: 7,
        date: "19 Oct 2026, 14:30 UTC",
        timestamp: 1700000000000,
        subscriber: "GA_SUBSCRIBER_12345",
        merchant: "GB_MERCHANT_67890",
        gross: 25_000_000n,
        fee: 250_000n,
        net: 24_750_000n,
        tokenMeta: XLM,
        chargeNumber: 1,
        totalCharges: 12,
        ledger: 54321,
        period: 2592000,
        planId: 3,
        source: "api",
      },
      apiAvailable: true,
      error: null,
    });
    clipboardMock.copyToClipboard.mockResolvedValue(true);
    window.history.replaceState({}, "", "/receipt/?private=state");

    render(<ReceiptPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Share this receipt" }));

    expect(await screen.findByText("Receipt link copied")).toBeTruthy();
    expect(clipboardMock.copyToClipboard).toHaveBeenCalledWith(
      `${window.location.origin}/receipt/?tx=${txHash}&mandate=7`,
    );
  });

  it("shows a clear error when loading the receipt rejects", async () => {
    mockSearchParams = new URLSearchParams({ tx: "tx", mandate: "7" });
    receiptMock.loadReceipt.mockRejectedValue(new Error("network unavailable"));
    render(<ReceiptPage />);
    expect(await screen.findByText("network unavailable")).toBeTruthy();
  });

  it("announces the loading state while the receipt request is pending", () => {
    mockSearchParams = new URLSearchParams({ tx: "tx", mandate: "7" });
    receiptMock.loadReceipt.mockReturnValue(new Promise(() => {}));
    render(<ReceiptPage />);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Loading receipt…")).toBeTruthy();
  });
});
