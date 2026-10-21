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

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("@/lib/chain", () => ({
  chainProtocolStats: chainMock.chainProtocolStats,
}));

vi.mock("@/lib/token", () => ({
  useTokenMetas: () => new Map(),
  metaFor: () => ({ symbol: "XLM", decimals: 7 }),
}));

describe("Home page protocol stats (#14)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.recentCharges.mockResolvedValue({ charges: [] });
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
});
