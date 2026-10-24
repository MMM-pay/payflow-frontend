// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import SubscribePage from "@/app/subscribe/page";
import type { ApiPlan } from "@/lib/api";

/**
 * A shared plan link (issue #19): `/subscribe/?plan=12` shows that plan alone.
 * The cases that matter are the link that names a plan, the link that names a
 * plan which is gone, and the link that names nothing at all.
 */

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";

let search = "";

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

const apiMock = vi.hoisted(() => ({ plans: vi.fn() }));
const chainMock = vi.hoisted(() => ({ chainPlans: vi.fn() }));
const payflowMock = vi.hoisted(() => ({ subscribe: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
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
  search = "";
  wallet.address = null;
  wallet.networkMismatch = false;
  apiMock.plans.mockReset();
  chainMock.chainPlans.mockReset();
  payflowMock.subscribe.mockReset();
  apiMock.plans.mockResolvedValue({
    plans: [plan(), plan({ id: 2, name: "Yearly" })],
  });
});

afterEach(cleanup);

describe("SubscribePage with a shared plan link", () => {
  it("lists every plan when the link names none", async () => {
    render(<SubscribePage />);

    expect(await screen.findByText("Pro Monthly")).toBeTruthy();
    expect(screen.getByText("Yearly")).toBeTruthy();
    expect(screen.queryByText(/see all plans/i)).toBeNull();
  });

  it("shows only the plan the link names", async () => {
    search = "plan=2";
    render(<SubscribePage />);

    // The plan is the heading of the page and the title of its card.
    expect(await screen.findByRole("heading", { level: 1, name: "Yearly" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Yearly" })).toBeTruthy();
    expect(screen.queryByText("Pro Monthly")).toBeNull();
  });

  it("offers a way back to the whole catalogue", async () => {
    search = "plan=2";
    render(<SubscribePage />);

    const back = await screen.findByRole("link", { name: /see all plans/i });
    expect(back.getAttribute("href")).toBe("/subscribe/");
  });

  it("says so when the plan is gone, instead of showing an empty page", async () => {
    search = "plan=404";
    render(<SubscribePage />);

    expect(await screen.findByText(/no longer listed/i)).toBeTruthy();
    expect(screen.queryByText("Pro Monthly")).toBeNull();
  });

  it("falls back to the catalogue when the parameter names no plan", async () => {
    search = "plan=not-a-plan";
    render(<SubscribePage />);

    expect(await screen.findByText(/does not name a plan/i)).toBeTruthy();
    expect(screen.getByText("Pro Monthly")).toBeTruthy();
    expect(screen.getByText("Yearly")).toBeTruthy();
  });

  it("does not offer a deactivated plan", async () => {
    search = "plan=2";
    apiMock.plans.mockResolvedValue({
      plans: [plan(), plan({ id: 2, name: "Yearly", active: 0 })],
    });
    render(<SubscribePage />);

    expect(await screen.findByText(/no longer listed/i)).toBeTruthy();
    expect(screen.queryByText("Yearly")).toBeNull();
  });

  it("reads the plans from the contract when there is no indexer", async () => {
    search = "plan=2";
    apiMock.plans.mockResolvedValue(null);
    chainMock.chainPlans.mockResolvedValue([plan(), plan({ id: 2, name: "Yearly" })]);
    render(<SubscribePage />);

    expect(await screen.findByRole("heading", { level: 2, name: "Yearly" })).toBeTruthy();
    expect(screen.queryByText("Pro Monthly")).toBeNull();
    expect(screen.getByText(/reading plans directly from the contract/i)).toBeTruthy();
  });
});
