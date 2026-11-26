// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import MandatesPage from "@/app/mandates/page";
import type { ApiMandate } from "@/lib/api";

const apiMock = vi.hoisted(() => ({
  isConfigured: vi.fn(() => true),
  mandate: vi.fn(),
  charges: vi.fn(),
}));

const chainMock = vi.hoisted(() => ({
  chainMandate: vi.fn(),
}));

const payflowMock = vi.hoisted(() => ({
  getPlan: vi.fn(),
  vaultBalance: vi.fn(async () => 50_000_000n),
  charge: vi.fn(async () => "tx-charge-123"),
  setPaused: vi.fn(async () => "tx-pause-123"),
  cancel: vi.fn(async () => "tx-cancel-123"),
  endMandate: vi.fn(async () => "tx-end-123"),
}));

const walletMock = vi.hoisted(() => ({
  address: "GSUBSCRIBER1234567890",
  networkMismatch: false,
  signXdr: vi.fn(async () => "AAAA...signed"),
}));

let currentSearchParam: string | null = "1";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "id" ? currentSearchParam : null),
  }),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("@/lib/chain", () => ({
  chainMandate: chainMock.chainMandate,
}));

// The page reads these from the SDK-free core, so the stubs stand there too.
vi.mock("@/lib/payflow-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payflow-core")>()),
  mandatePendingTransfer: () => null,
  mandateStatus: (s: unknown) => (Array.isArray(s) ? s[0] : s),
}));
vi.mock("@/lib/payflow", () => ({
  // The account page reads the trustline check as a module export.
  checkTrustline: async () => true,
  // payflow-contract#68 not shipped; the two-step transfer stays off.
  mandateSupportsTransfer: () => false,
  mandatePendingTransfer: () => null,
  payflow: payflowMock,
  mandateStatus: (s: unknown) => (Array.isArray(s) ? s[0] : s),
}));

vi.mock("@/lib/wallet", () => ({
  useWallet: () => walletMock,
}));

vi.mock("@/lib/token", () => ({
  useTokenMetas: () => new Map(),
  metaFor: () => ({ symbol: "XLM", decimals: 7 }),
}));

function mockMandate(overrides: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 1,
    subscriber: "GSUBSCRIBER1234567890",
    merchant: "GMERCHANT9876543210",
    plan_id: 42,
    amount: "10000000", // 1 XLM
    period: 2_592_000, // 30 days
    next_charge: 1700000000,
    last_charge: 1697408000,
    charges_made: 3,
    max_charges: 12,
    fee_bps: 100,
    status: "Active",
    token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    ended_by: null,
    ...overrides,
  };
}

describe("Mandate details page (/mandates/?id=N) (#10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParam = "1";
    walletMock.address = "GSUBSCRIBER1234567890";
    apiMock.isConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows empty state when no id query param is present", async () => {
    currentSearchParam = null;
    render(<MandatesPage />);
    expect(screen.getByText("No mandate specified")).toBeTruthy();
  });

  it("renders mandate details, terms, and charges from indexer", async () => {
    apiMock.mandate.mockResolvedValue(mockMandate());
    apiMock.charges.mockResolvedValue({
      charges: [
        {
          mandate_id: 1,
          subscriber: "GSUBSCRIBER1234567890",
          merchant: "GMERCHANT9876543210",
          plan_id: 42,
          amount: "20000000",
          fee: "100000",
          charges_made: 1,
          ledger: 12345,
          tx_hash: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234",
        },
      ],
    });
    payflowMock.getPlan.mockResolvedValue({
      id: 42n,
      merchant: "GMERCHANT9876543210",
      name: "Gold Tier",
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      amount: 10000000n,
      period: 2592000n,
      active: true,
    });

    render(<MandatesPage />);

    await waitFor(() => {
      expect(screen.getByText("Mandate #1")).toBeTruthy();
    });

    expect(screen.getByText("Gold Tier")).toBeTruthy();
    expect(screen.getByText("3 / 12")).toBeTruthy();
    expect(screen.getByText("1%")).toBeTruthy();
    // Subscriber action visible
    expect(screen.getByRole("button", { name: /Pause subscription/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Cancel subscription/i })).toBeTruthy();

    // Monetary columns are right-aligned and monospace; non-monetary columns are not.
    const monetaryCell = (text: string): HTMLElement => {
      for (const el of screen.getAllByText(text)) {
        const cell = el.closest("td");
        if (cell && cell.className.includes("font-mono")) return cell as HTMLElement;
      }
      throw new Error(`No monospaced cell for ${text}`);
    };
    const amountCell = monetaryCell("2 XLM");
    const feeCell = monetaryCell("0.01 XLM");
    expect(amountCell.className).toContain("text-right");
    expect(amountCell.className).toContain("font-mono");
    expect(amountCell.className).toContain("tabular-nums");
    expect(feeCell.className).toContain("text-right");
    expect(feeCell.className).toContain("font-mono");
    expect(feeCell.className).toContain("tabular-nums");
    expect(screen.getByText("Amount").closest("th")?.className).toContain("text-right");
    expect(screen.getByText("Fee").closest("th")?.className).toContain("text-right");
    const ledgerCell = screen.getByText("#12345").closest("td");
    expect(ledgerCell?.className).not.toContain("font-mono");
  });

  it("pages API-backed charge history with a zero-based offset", async () => {
    apiMock.mandate.mockResolvedValue(mockMandate());
    apiMock.charges.mockResolvedValue({
      charges: Array.from({ length: 11 }, (_, index) => ({
        mandate_id: 1,
        subscriber: "GSUBSCRIBER1234567890",
        merchant: "GMERCHANT9876543210",
        plan_id: 42,
        amount: "10000000",
        fee: "100000",
        charges_made: index + 1,
        ledger: 10000 + index,
        tx_hash: String(index).padStart(64, "0"),
      })),
    });
    payflowMock.getPlan.mockResolvedValue({
      id: 42n,
      merchant: "GMERCHANT9876543210",
      name: "Gold Tier",
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      amount: 10000000n,
      period: 2592000n,
      active: true,
    });

    render(<MandatesPage />);
    expect(await screen.findByText("Mandate #1")).toBeTruthy();
    expect(screen.getByText("#10000")).toBeTruthy();
    expect(screen.getByText("#10009")).toBeTruthy();
    expect(screen.queryByText("#10010")).toBeNull();
    expect(await screen.findByText("Showing 1–10 of 11")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("#10010")).toBeTruthy();
    expect(screen.queryByText("#10000")).toBeNull();
  });

  it("falls back to contract state when indexer is not configured (contract-only mode)", async () => {
    apiMock.isConfigured.mockReturnValue(false);
    chainMock.chainMandate.mockResolvedValue(mockMandate({ id: 99, charges_made: 5 }));
    payflowMock.getPlan.mockResolvedValue(null);

    currentSearchParam = "99";
    render(<MandatesPage />);

    await waitFor(() => {
      expect(screen.getByText("Mandate #99")).toBeTruthy();
    });

    expect(chainMock.chainMandate).toHaveBeenCalledWith(expect.any(String), 99);
    // Informs user that charge history requires the indexer
    expect(screen.getByText(/Charge history requires the indexer/i)).toBeTruthy();
  });

  it("offers merchant actions when connected wallet is the merchant", async () => {
    walletMock.address = "GMERCHANT9876543210";
    apiMock.mandate.mockResolvedValue(mockMandate({ next_charge: 100 })); // in the past -> due now!
    apiMock.charges.mockResolvedValue({ charges: [] });

    render(<MandatesPage />);

    await waitFor(() => {
      expect(screen.getByText("Mandate #1")).toBeTruthy();
    });

    // Merchant can charge when due
    expect(screen.getByRole("button", { name: /Charge now/i })).toBeTruthy();
    // Merchant can end mandate
    expect(screen.getByRole("button", { name: /End mandate/i })).toBeTruthy();
  });

  it("executes cancel subscription flow with confirmation", async () => {
    walletMock.address = "GSUBSCRIBER1234567890";
    apiMock.mandate.mockResolvedValue(mockMandate());
    apiMock.charges.mockResolvedValue({ charges: [] });

    render(<MandatesPage />);

    await waitFor(() => {
      expect(screen.getByText("Mandate #1")).toBeTruthy();
    });

    const cancelBtn = screen.getByRole("button", { name: /Cancel subscription/i });
    fireEvent.click(cancelBtn);

    const dialog = await screen.findByRole("dialog", { name: "Cancel subscription?" });
    const confirmBtn = within(dialog).getByRole("button", { name: "Confirm cancellation" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(payflowMock.cancel).toHaveBeenCalledWith(
        "GSUBSCRIBER1234567890",
        expect.any(Function),
        1,
      );
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the dialog open with the error on a failed cancel, and lets a retry succeed", async () => {
    walletMock.address = "GSUBSCRIBER1234567890";
    apiMock.mandate.mockResolvedValue(mockMandate());
    apiMock.charges.mockResolvedValue({ charges: [] });
    payflowMock.cancel
      .mockRejectedValueOnce(new Error("host error: insufficient fee"))
      .mockResolvedValueOnce("tx-cancel-123");

    render(<MandatesPage />);

    await waitFor(() => {
      expect(screen.getByText("Mandate #1")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Cancel subscription/i }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel subscription?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm cancellation" }));

    await waitFor(() => expect(dialog.textContent).toContain("host error: insufficient fee"));

    // Still open: a retry can be made without re-stating the confirmation.
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm cancellation" }));
    await waitFor(() => expect(payflowMock.cancel).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
