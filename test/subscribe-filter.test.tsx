// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import SubscribePage from "@/app/subscribe/page";
import type { ApiPlan } from "@/lib/api";

const apiMock = vi.hoisted(() => ({
  plans: vi.fn(),
}));

const walletMock = vi.hoisted(() => ({
  address: "GSUBSCRIBER1234567890",
  networkMismatch: false,
  signXdr: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("@/lib/wallet", () => ({
  useWallet: () => walletMock,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/token", () => ({
  useTokenMetas: () => new Map(),
  metaFor: () => ({ symbol: "XLM", decimals: 7 }),
}));

function makePlan(id: number, name: string, amount: string, period: number): ApiPlan {
  return {
    id,
    merchant: "GMERCHANT123456789",
    name,
    token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    amount,
    period,
    active: 1,
    ledger: 100,
  };
}

describe("Subscribe page plan filtering and sorting (#18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders billing period filter and sort options", async () => {
    apiMock.plans.mockResolvedValue({
      plans: [
        makePlan(1, "Daily Coffee", "5000000", 86_400),
        makePlan(2, "Monthly Software", "50000000", 2_592_000),
      ],
    });

    render(<SubscribePage />);

    await waitFor(() => {
      expect(screen.getByText("Daily Coffee")).toBeTruthy();
    });

    expect(screen.getByLabelText(/Billing period:/i)).toBeTruthy();
    expect(screen.getByLabelText(/Sort by:/i)).toBeTruthy();
    expect(screen.getByText("Monthly Software")).toBeTruthy();
  });

  it("filters plans when selecting a period", async () => {
    apiMock.plans.mockResolvedValue({
      plans: [
        makePlan(1, "Daily Coffee", "5000000", 86_400),
        makePlan(2, "Monthly Software", "50000000", 2_592_000),
      ],
    });

    render(<SubscribePage />);

    await waitFor(() => {
      expect(screen.getByText("Daily Coffee")).toBeTruthy();
    });

    const periodSelect = screen.getByLabelText(/Billing period:/i);
    fireEvent.change(periodSelect, { target: { value: "daily" } });

    expect(screen.getByText("Daily Coffee")).toBeTruthy();
    expect(screen.queryByText("Monthly Software")).toBeNull();
  });

  it("shows empty state when no plans match the filter and allows resetting", async () => {
    apiMock.plans.mockResolvedValue({
      plans: [
        makePlan(1, "Daily Coffee", "5000000", 86_400),
      ],
    });

    render(<SubscribePage />);

    await waitFor(() => {
      expect(screen.getByText("Daily Coffee")).toBeTruthy();
    });

    const periodSelect = screen.getByLabelText(/Billing period:/i);
    fireEvent.change(periodSelect, { target: { value: "yearly" } });

    expect(screen.getByText("No plans match this filter")).toBeTruthy();

    const resetBtn = screen.getByRole("button", { name: /Reset filters/i });
    fireEvent.click(resetBtn);

    expect(screen.getByText("Daily Coffee")).toBeTruthy();
  });
});
