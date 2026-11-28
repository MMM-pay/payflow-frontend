// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import HomePage from "@/app/page";

const apiMock = vi.hoisted(() => ({
  stats: vi.fn(),
  recentCharges: vi.fn(),
}));

const chainMock = vi.hoisted(() => ({
  chainProtocolStats: vi.fn(),
}));

const tokenMock = vi.hoisted(() => ({
  loadTokenMeta: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("@/lib/chain", () => ({
  chainProtocolStats: chainMock.chainProtocolStats,
}));

vi.mock("@/lib/token", () => ({
  loadTokenMeta: tokenMock.loadTokenMeta,
}));

describe("Home page protocol stats (#14)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.recentCharges.mockResolvedValue({ charges: [] });
    tokenMock.loadTokenMeta.mockResolvedValue({ symbol: "USDC", decimals: 6 });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders API stats when indexer is available and avoids contract RPC calls", async () => {
    apiMock.stats.mockResolvedValue({
      plans: 12,
      mandates: 45,
      activeMandates: 38,
      charges: 150,
      lastIndexedLedger: 54321,
    });

    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText("12")).toBeTruthy();
    });

    expect(screen.getByText("45")).toBeTruthy();
    expect(screen.getByText("38")).toBeTruthy();
    expect(screen.getByText("150")).toBeTruthy();

    // Crucial acceptance criterion: No extra RPC calls when the API is available
    expect(chainMock.chainProtocolStats).not.toHaveBeenCalled();
    expect(tokenMock.loadTokenMeta).not.toHaveBeenCalled();
  });

  it("falls back to reading plan count from contract state when API returns null", async () => {
    apiMock.stats.mockResolvedValue(null);
    chainMock.chainProtocolStats.mockResolvedValue({ plans: 8 });

    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText("8")).toBeTruthy();
    });

    expect(chainMock.chainProtocolStats).toHaveBeenCalled();
    // History counters show '—'
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
    // Contract badge / hint appears
    expect(screen.getByText("from contract")).toBeTruthy();
  });

  it("shows the indexer error state when both API calls fail", async () => {
    // api.ts normally fails soft, but the page must also survive a rejected
    // promise (proxy 502, aborted request) instead of leaving "…" forever.
    apiMock.stats.mockRejectedValue(new Error("502 Bad Gateway"));
    apiMock.recentCharges.mockRejectedValue(new Error("502 Bad Gateway"));
    chainMock.chainProtocolStats.mockRejectedValue(new Error("RPC unavailable"));

    render(<HomePage />);

    expect(
      await screen.findByText(/The indexer is unreachable, so historical activity counters require the indexer/i),
    ).toBeTruthy();
    // The contract fallback failed too, so the counters say so rather than
    // inventing zeroes.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("from contract")).toBeNull();
    expect(screen.queryByText("Recent activity")).toBeNull();
    expect(tokenMock.loadTokenMeta).not.toHaveBeenCalled();
  });

  it("loads token metadata only when there are recent charges to format", async () => {
    apiMock.stats.mockResolvedValue(null);
    apiMock.recentCharges.mockResolvedValue({
      charges: [
        {
          tx_hash: "tx-hash",
          plan_name: "Coffee",
          amount: "2500000",
          ledger: 42,
          timestamp: 1_700_000_000,
          plan_id: 1,
        },
      ],
    });
    chainMock.chainProtocolStats.mockResolvedValue({ plans: 8 });

    render(<HomePage />);

    await waitFor(() => {
      expect(tokenMock.loadTokenMeta).toHaveBeenCalledOnce();
    });
    expect(await screen.findByLabelText("2.5 USDC")).toBeTruthy();
  });
});
