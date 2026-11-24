// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import SubscribePage from "@/app/subscribe/page";
import type { ApiPlan } from "@/lib/api";

/**
 * Per-plan subscriber counts on the subscribe-page plan cards (issue #303).
 * The stats API fails soft, so every case here is driven by mocked responses
 * — no real network.
 */

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";

const wallet = vi.hoisted(() => ({
  address: null as string | null,
  connecting: false,
  error: null as string | null,
  networkMismatch: false,
  walletNetwork: null as string | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  signXdr: vi.fn(),
}));

const apiMock = vi.hoisted(() => ({ plans: vi.fn(), planStats: vi.fn() }));
const chainMock = vi.hoisted(() => ({ chainPlans: vi.fn() }));
const payflowMock = vi.hoisted(() => ({ subscribe: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: unknown }) => (
    <a href={typeof href === "string" ? href : ""} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/wallet", () => ({ useWallet: () => wallet }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chain")>()),
  chainPlans: chainMock.chainPlans,
}));
vi.mock("@/lib/token", () => ({
  metaFor: () => ({ symbol: "XLM", decimals: 7 }),
  useTokenMetas: () => new Map(),
}));
vi.mock("@/lib/toml", () => ({ useOrgName: () => "Acme Payments" }));
vi.mock("@/lib/payflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payflow")>()),
  payflow: payflowMock,
}));

function plan(overrides: Partial<ApiPlan> = {}): ApiPlan {
  return {
    id: 1,
    merchant: MERCHANT,
    name: "Pro Monthly",
    token: "",
    amount: "10000000",
    period: 2_592_000,
    active: 1,
    ledger: 0,
    ...overrides,
  };
}

beforeEach(() => {
  wallet.address = null;
  wallet.networkMismatch = false;
  vi.resetAllMocks();
  apiMock.plans.mockResolvedValue({ plans: [plan()] });
  apiMock.planStats.mockResolvedValue({
    subscriber_count: 7,
    total_collected: "12345678",
    cancellations: 1,
  });
  chainMock.chainPlans.mockResolvedValue([]);
  payflowMock.subscribe.mockResolvedValue("tx-hash");
});

afterEach(() => {
  cleanup();
});

describe("Subscribe page subscriber count", () => {
  it("renders the subscriber count when the stats API supplies it", async () => {
    render(<SubscribePage />);

    await waitFor(() => expect(screen.getByText("Pro Monthly")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Subscribers")).toBeTruthy());

    const label = screen.getByText("Subscribers");
    expect(label.parentElement?.textContent).toContain("7");
  });

  it("renders zero subscribers clearly", async () => {
    apiMock.planStats.mockResolvedValue({
      subscriber_count: 0,
      total_collected: "0",
      cancellations: 0,
    });

    render(<SubscribePage />);

    await waitFor(() => expect(screen.getByText("Subscribers")).toBeTruthy());
    const label = screen.getByText("Subscribers");
    expect(label.parentElement?.textContent).toContain("0");
  });

  it("hides the count entirely when statistics are missing or unavailable", async () => {
    apiMock.planStats.mockResolvedValue(null);

    render(<SubscribePage />);

    await waitFor(() => expect(screen.getByText("Pro Monthly")).toBeTruthy());
    expect(screen.queryByText("Subscribers")).toBeNull();
  });

  it("shows a loading placeholder rather than a zero while stats are loading", async () => {
    // The stats promise never settles, so the card stays in the loading state.
    apiMock.planStats.mockImplementation(() => new Promise(() => {}));

    render(<SubscribePage />);

    await waitFor(() => expect(screen.getByText("Pro Monthly")).toBeTruthy());
    expect(screen.getByText("Loading subscribers")).toBeTruthy();
    expect(screen.queryByText("Subscribers")).toBeNull();
  });
});
