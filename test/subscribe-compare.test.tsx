// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubscribePage from "@/app/subscribe/page";
import type { ApiPlan } from "@/lib/api";

const apiMock = vi.hoisted(() => ({ plans: vi.fn() }));
const chainMock = vi.hoisted(() => ({ chainPlans: vi.fn() }));

const walletMock = vi.hoisted(() => ({
  address: null as string | null,
  networkMismatch: false,
  signXdr: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/chain", () => ({ chainPlans: chainMock.chainPlans }));
vi.mock("@/lib/wallet", () => ({ useWallet: () => walletMock }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/token", () => ({
  useTokenMetas: () => new Map(),
  metaFor: () => ({ symbol: "XLM", decimals: 7 }),
}));
vi.mock("@/lib/toml", () => ({ useOrgName: () => null }));

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

beforeEach(() => {
  vi.clearAllMocks();
  chainMock.chainPlans.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Subscribe plan comparison (#175)", () => {
  it("opens an accessible table with bigint monthly equivalents", async () => {
    apiMock.plans.mockResolvedValue({
      plans: [
        makePlan(1, "Daily Coffee", "5000000", 86_400), // 0.5 XLM/day → 15 XLM/30d
        makePlan(2, "Weekly Gym", "20000000", 604_800), // 2 XLM/week → 8.5714 XLM/30d
        makePlan(3, "Yearly Hosting", "1000000000", 31_536_000),
      ],
    });

    render(<SubscribePage />);
    await screen.findByText("Daily Coffee");

    // Nothing is selected, so there is no comparison bar or table yet.
    expect(screen.queryByRole("table")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Compare Daily Coffee" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare Weekly Gym" }));

    expect(screen.getByText(/2 of 3 plans selected/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Compare plans" }));

    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["Feature", "Daily Coffee", "Weekly Gym"]);
    // 0.5 XLM/day over a 30-day month, kept as a bigint through formatting.
    expect(within(table).getByText("15 XLM")).toBeTruthy();
    expect(within(table).getByText(/Monthly equivalent/)).toBeTruthy();
  });

  it("compares plans read directly from contract state when the indexer is off", async () => {
    // The public demo has no NEXT_PUBLIC_API_URL: api.plans() resolves null and
    // the page reads chain state. Comparison is local, so it must still work.
    apiMock.plans.mockResolvedValue(null);
    chainMock.chainPlans.mockResolvedValue([
      makePlan(1, "Daily Coffee", "5000000", 86_400),
      makePlan(2, "Monthly Software", "50000000", 2_592_000),
    ]);

    render(<SubscribePage />);
    expect(await screen.findByText(/Reading plans directly from the contract/)).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Compare Daily Coffee" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare Monthly Software" }));
    fireEvent.click(screen.getByRole("button", { name: "Compare plans" }));

    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.getByText("15 XLM")).toBeTruthy();
  });

  it("caps the selection at three plans", async () => {
    apiMock.plans.mockResolvedValue({
      plans: [
        makePlan(1, "One", "1000000", 2_592_000),
        makePlan(2, "Two", "1000000", 2_592_000),
        makePlan(3, "Three", "1000000", 2_592_000),
        makePlan(4, "Four", "1000000", 2_592_000),
      ],
    });

    render(<SubscribePage />);
    await screen.findByText("One");

    fireEvent.click(screen.getByRole("checkbox", { name: "Compare One" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare Two" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare Three" }));

    expect(
      (screen.getByRole("checkbox", { name: "Compare Four" }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/maximum/)).toBeTruthy();
  });

  it("keeps selected plans comparable when the filter hides their cards", async () => {
    apiMock.plans.mockResolvedValue({
      plans: [
        makePlan(1, "Daily Coffee", "5000000", 86_400),
        makePlan(2, "Monthly Software", "50000000", 2_592_000),
      ],
    });

    render(<SubscribePage />);
    await screen.findByText("Daily Coffee");
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare Daily Coffee" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare Monthly Software" }));

    fireEvent.change(screen.getByLabelText(/Billing period:/i), {
      target: { value: "daily" },
    });
    expect(screen.queryByText("Monthly Software")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Compare plans" }));
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Monthly Software")).toBeTruthy();
  });

  it("closes and forgets the comparison when it is cleared", async () => {
    apiMock.plans.mockResolvedValue({
      plans: [
        makePlan(1, "One", "1000000", 2_592_000),
        makePlan(2, "Two", "1000000", 2_592_000),
      ],
    });

    render(<SubscribePage />);
    await screen.findByText("One");
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare One" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare Two" }));
    fireEvent.click(screen.getByRole("button", { name: "Compare plans" }));
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
  });
});
