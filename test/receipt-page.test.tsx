// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("@/lib/receipt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/receipt")>();
  return {
    ...actual,
    loadReceipt: receiptMock.loadReceipt,
  };
});

describe("ReceiptPage component", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    receiptMock.loadReceipt.mockReset();
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
    expect(screen.getAllByText("2.5 XLM").length).toBeGreaterThan(0);
    expect(screen.getByText("-0.025 XLM")).toBeTruthy();
    expect(screen.getByText("2.475 XLM")).toBeTruthy();

    // Print button
    const printBtn = screen.getByRole("button", { name: /Print this receipt/i });
    expect(printBtn).toBeTruthy();

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
});

describe("receipt charge fields (#388)", () => {
  const TX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const SUBSCRIBER = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";
  const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";

  function representativeReceipt(overrides: Partial<ReceiptData> = {}): ReceiptData {
    return {
      txHash: TX,
      mandateId: 42,
      date: "19 Oct 2026, 14:30 UTC",
      timestamp: Date.UTC(2026, 9, 19, 14, 30, 0),
      subscriber: SUBSCRIBER,
      merchant: MERCHANT,
      gross: 125_000_000n, // 12.5 XLM
      fee: 1_250_000n, // 0.125 XLM
      net: 123_750_000n, // 12.375 XLM
      tokenMeta: XLM,
      chargeNumber: 4,
      totalCharges: 12,
      ledger: 987_654,
      period: 2_592_000, // monthly
      planId: 9,
      source: "api",
      ...overrides,
    };
  }

  function renderReceipt(receipt: ReceiptData | null, apiAvailable = true, error: string | null = null) {
    mockSearchParams = new URLSearchParams({ tx: TX, mandate: "42" });
    receiptMock.loadReceipt.mockResolvedValue({ receipt, apiAvailable, error });
    render(<ReceiptPage />);
  }

  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    receiptMock.loadReceipt.mockReset();
  });

  afterEach(cleanup);

  it("snapshots a representative charge with every field visible", async () => {
    renderReceipt(representativeReceipt());

    const receiptCard = await screen.findByRole("article", {
      name: "Payment receipt for mandate 42",
    });
    const text = receiptCard.textContent ?? "";

    // Header and status.
    expect(screen.getByText("Payment Receipt")).toBeTruthy();
    expect(screen.getByText("Settled")).toBeTruthy();
    expect(screen.getByText("Mandate #42 · Plan #9")).toBeTruthy();
    expect(screen.getByText("19 Oct 2026, 14:30 UTC")).toBeTruthy();

    // Parties, billing frequency and charge sequence.
    expect(screen.getByText("Subscriber (Payer)")).toBeTruthy();
    expect(screen.getByText("Merchant (Payee)")).toBeTruthy();
    expect(screen.getByText("Billing frequency")).toBeTruthy();
    expect(screen.getByText("per month")).toBeTruthy();
    expect(screen.getByText("Charge sequence")).toBeTruthy();
    expect(screen.getByText("Charge 4 of 12 · Ledger #987654")).toBeTruthy();

    // Both party addresses are linked to the explorer using the shortened form.
    expect(screen.getByText("GAP6QF…MNDTIE")).toBeTruthy();
    expect(screen.getByText("GCH5VH…6Z3MHU")).toBeTruthy();
    expect(
      screen.getByText("GAP6QF…MNDTIE").closest("a")?.getAttribute("href"),
    ).toContain(`/account/${SUBSCRIBER}`);
    expect(
      screen.getByText("GCH5VH…6Z3MHU").closest("a")?.getAttribute("href"),
    ).toContain(`/account/${MERCHANT}`);

    // The breakdown table shows the gross, fee and net as bigint-derived strings.
    expect(text).toContain("Subscription charge (Mandate #42)");
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("Amount")).toBeTruthy();
    expect(screen.getAllByText("12.5 XLM")).toHaveLength(2); // charge row and total
    expect(screen.getByText("-0.125 XLM")).toBeTruthy();
    expect(screen.getByText("12.375 XLM")).toBeTruthy();
    expect(screen.getByText("Protocol fee")).toBeTruthy();
    expect(screen.getByText("Net payout to merchant")).toBeTruthy();
    expect(screen.getByText("Total Paid")).toBeTruthy();

    // Transaction proof carries the full and shortened hash, plus the explorer link.
    expect(text).toContain(`Hash: ${TX}`);
    expect(screen.getByText("012345…abcdef")).toBeTruthy();
    expect(
      screen.getByText("012345…abcdef").closest("a")?.getAttribute("href"),
    ).toContain(`/tx/${TX}`);
    expect(text).toContain(
      "Settled permissionlessly on Stellar via Payflow recurring mandate.",
    );

    // Both actions are present and labelled.
    expect(screen.getByRole("button", { name: "Download this receipt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print this receipt" })).toBeTruthy();
  });

  it("falls back to recurring-charge labels when the sequence and ledger are unknown", async () => {
    renderReceipt(
      representativeReceipt({
        chargeNumber: null,
        totalCharges: null,
        ledger: null,
        fee: 0n,
        source: "contract-estimate",
      }),
      false,
    );

    const receiptCard = await screen.findByRole("article", {
      name: "Payment receipt for mandate 42",
    });

    // No invented charge number or ledger.
    expect(receiptCard.textContent).toContain("Recurring charge");
    expect(receiptCard.textContent).not.toContain("Ledger #");
    expect(receiptCard.textContent).not.toContain("Charge 0");
    // A zero protocol fee is still shown explicitly rather than omitted.
    expect(screen.getByText("-0 XLM")).toBeTruthy();
    // The receipt says why the history is estimated.
    expect(screen.getByText(/Contract-only mode:/i)).toBeTruthy();
  });

  it("renders the error state when the charge cannot be loaded for valid parameters", async () => {
    const error = "Mandate #42 could not be found on-chain or in API index.";
    renderReceipt(null, false, error);

    expect(await screen.findByText("Could not load receipt")).toBeTruthy();
    expect(screen.getByText(error)).toBeTruthy();
    // A failed load must not leave a half-rendered receipt on screen.
    expect(screen.queryByRole("article")).toBeNull();
  });
});
