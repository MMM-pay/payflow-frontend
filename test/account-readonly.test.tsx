// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AccountPage from "@/app/account/page";
import type { ApiMandate } from "@/lib/api";

const TARGET_SUBSCRIBER = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";
const OTHER_WALLET = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";

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

const apiMock = vi.hoisted(() => ({
  mandatesOf: vi.fn(),
  vaultHistory: vi.fn(),
}));

const payflowMock = vi.hoisted(() => ({
  vaultBalance: vi.fn(),
  deposit: vi.fn(),
  withdraw: vi.fn(),
  setPaused: vi.fn(),
  pauseUntil: vi.fn(),
  cancel: vi.fn(),
  checkTrustline: vi.fn(() => true),
  addTrustline: vi.fn(),
}));

const payflowHelpers = vi.hoisted(() => ({
  mandatePauseUntil: vi.fn(() => null),
  mandateIsPastDue: vi.fn(() => false),
  mandatePastDueUntil: vi.fn(() => null),
}));

const chainMock = vi.hoisted(() => ({
  chainMandatesOf: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

vi.mock("@/lib/wallet", () => ({ useWallet: () => wallet }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    api: {
      isConfigured: () => false,
      mandatesOf: apiMock.mandatesOf,
      vaultHistory: apiMock.vaultHistory,
      stream: () => null,
    },
    checkWebhookUrl: actual.checkWebhookUrl,
  };
});
vi.mock("@/lib/payflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payflow")>()),
  payflow: payflowMock,
  mandateStatus: (s: unknown) => (Array.isArray(s) ? s[0] : s),
  ...payflowHelpers,
}));
vi.mock("@/lib/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chain")>()),
  chainMandatesOf: chainMock.chainMandatesOf,
}));
vi.mock("@/lib/toml", () => ({ useOrgName: () => null }));

function mandate(overrides: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 7,
    subscriber: TARGET_SUBSCRIBER,
    merchant: OTHER_WALLET,
    plan_id: 1,
    amount: "10000000",
    period: 2_592_000,
    next_charge: 0,
    last_charge: 0,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
    ...overrides,
  };
}

describe("AccountPage read-only mode (#62)", () => {
  beforeEach(() => {
    wallet.address = null;
    search = `address=${TARGET_SUBSCRIBER}`;
    apiMock.mandatesOf.mockReset();
    apiMock.vaultHistory.mockReset();
    payflowMock.vaultBalance.mockReset();
    payflowMock.vaultBalance.mockResolvedValue(50_000_000n);
    apiMock.mandatesOf.mockResolvedValue({ mandates: [mandate()] });
    apiMock.vaultHistory.mockResolvedValue({ events: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders target subscriber's subscriptions in read-only mode without connected wallet", async () => {
    render(<AccountPage />);

    expect(await screen.findAllByText(/Read-only/i)).toBeTruthy();
    expect(await screen.findByText("Mandate #7")).toBeTruthy();

    // Acceptance criterion: Actions hidden in read-only mode
    expect(screen.queryByRole("button", { name: "Cancel all" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancel subscription/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deposit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  });

  it("keeps actions hidden when connected wallet does not match the target address", async () => {
    wallet.address = OTHER_WALLET; // Connected, but different account
    render(<AccountPage />);

    expect(await screen.findAllByText(/Read-only/i)).toBeTruthy();
    expect(await screen.findByText("Mandate #7")).toBeTruthy();

    // Actions must remain hidden
    expect(screen.queryByRole("button", { name: "Cancel all" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancel subscription/i })).toBeNull();
  });

  it("enables actions when connected wallet matches the target address", async () => {
    wallet.address = TARGET_SUBSCRIBER; // Matches!
    render(<AccountPage />);

    expect(await screen.findByText("Mandate #7")).toBeTruthy();

    // Not in read-only mode
    expect(screen.queryByText(/Read-only/i)).toBeNull();

    // Action buttons are visible
    expect(await screen.findByRole("button", { name: "Cancel all" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Pause" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Deposit" })).toBeTruthy();
  });
});
