// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AccountPage from "@/app/account/page";
import type { ApiMandate } from "@/lib/api";

/**
 * The account page is the first page rendered in tests because it exercises
 * all three data paths the issue calls out: a wallet-less visitor, the indexer,
 * and the contract-only fallback used by the public demo. The wallet is mocked
 * so the test never touches Stellar Wallets Kit or the network.
 */

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
}));

const payflowMock = vi.hoisted(() => ({
  vaultBalance: vi.fn(),
  deposit: vi.fn(),
  withdraw: vi.fn(),
  setPaused: vi.fn(),
  cancel: vi.fn(),
  readContract: vi.fn(),
}));

const chainMock = vi.hoisted(() => ({
  chainMandatesOf: vi.fn(),
}));

vi.mock("@/lib/wallet", () => ({ useWallet: () => wallet }));
vi.mock("@/lib/api", () => ({ api: { mandatesOf: apiMock.mandatesOf } }));
vi.mock("@/lib/payflow", () => ({ payflow: payflowMock, readContract: payflowMock.readContract }));
vi.mock("@/lib/chain", () => ({ chainMandatesOf: chainMock.chainMandatesOf }));

// Pinned so the page has a token contract to ask about. Without it the token
// id is "" in tests and every amount falls back to native XLM.
vi.mock("@/lib/config", () => ({
  config: {
    rpcUrl: "http://localhost:8000/rpc",
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "TESTNET",
    apiUrl: "http://localhost:8080",
    readSource: "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE",
    contracts: {
      planRegistry: "CDQ5EJTVXXX2CBMHWP3BGGUDHSK6D4I25IF5XXH3QGL2TNTBMJUOFKDB",
      vault: "CBNQEWSYYQOKNX5KB62OFT6ID5TCVSWN4PS4AXAJK6IWUEXOLVN6DXII",
      subscription: "CD5YZUJU6WLFIHGAV4J2BV42GCVZE5ZGDUGSW5CBRIA47TQHSZZW3XMM",
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    },
  },
  explorerBase: "https://stellar.expert/explorer/testnet",
  requireContracts: () => {},
}));

const SUBSCRIBER = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";
const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";

function mandate(overrides: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 7,
    subscriber: SUBSCRIBER,
    merchant: MERCHANT,
    plan_id: 1,
    amount: "10000000", // 1 XLM
    period: 2_592_000, // monthly
    next_charge: 0,
    last_charge: 0,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
    ended_by: null,
    ...overrides,
  };
}

beforeEach(async () => {
  wallet.address = SUBSCRIBER;
  wallet.connecting = false;
  wallet.error = null;
  wallet.networkMismatch = false;
  wallet.walletNetwork = null;
  apiMock.mandatesOf.mockReset();
  payflowMock.vaultBalance.mockReset();
  payflowMock.deposit.mockReset();
  payflowMock.withdraw.mockReset();
  payflowMock.setPaused.mockReset();
  payflowMock.cancel.mockReset();
  payflowMock.readContract.mockReset();
  chainMock.chainMandatesOf.mockReset();
  // The token metadata cache is module-level and outlives a single render.
  const { clearTokenMetaCache } = await import("@/lib/token");
  clearTokenMetaCache();
});

afterEach(cleanup);

describe("AccountPage", () => {
  it("asks for a wallet when none is connected", () => {
    wallet.address = null;
    render(<AccountPage />);

    expect(
      screen.getByText(/connect a wallet to see your vault balance/i),
    ).toBeTruthy();
    expect(apiMock.mandatesOf).not.toHaveBeenCalled();
  });

  it("renders the vault balance and mandates served by the indexer", async () => {
    payflowMock.vaultBalance.mockResolvedValue(50_000_000n);
    apiMock.mandatesOf.mockResolvedValue({ mandates: [mandate()] });

    render(<AccountPage />);

    // 50_000_000 stroops renders as 5 XLM, not 50000000.
    expect(await screen.findByText("5 XLM")).toBeTruthy();
    expect(screen.getByText("Mandate #7")).toBeTruthy();
    expect(screen.getByText(/1 XLM per month/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByText("Active subscriptions").parentElement?.textContent).toContain(
      "1",
    );
    expect(payflowMock.vaultBalance).toHaveBeenCalledWith(
      SUBSCRIBER,
      SUBSCRIBER,
      expect.any(String),
    );
    expect(chainMock.chainMandatesOf).not.toHaveBeenCalled();
  });

  it("falls back to contract state when the indexer is unavailable", async () => {
    // The public demo runs without a backend; api methods return null rather
    // than throwing, and the page must still list the subscriber's mandates.
    payflowMock.vaultBalance.mockResolvedValue(0n);
    apiMock.mandatesOf.mockResolvedValue(null);
    chainMock.chainMandatesOf.mockResolvedValue([
      mandate({ id: 9, status: "Cancelled" }),
    ]);

    render(<AccountPage />);

    expect(await screen.findByText("Mandate #9")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(chainMock.chainMandatesOf).toHaveBeenCalledWith(SUBSCRIBER, SUBSCRIBER);
    // Cancelled mandates are terminal, so the page must not offer Cancel.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("disables write actions while the wallet is on the wrong network", async () => {
    wallet.networkMismatch = true;
    payflowMock.vaultBalance.mockResolvedValue(0n);
    apiMock.mandatesOf.mockResolvedValue({ mandates: [mandate()] });

    render(<AccountPage />);

    const deposit = (await screen.findByRole("button", {
      name: "Deposit",
    })) as HTMLButtonElement;
    const withdraw = screen.getByRole("button", { name: "Withdraw" }) as HTMLButtonElement;
    const pause = (await screen.findByRole("button", {
      name: "Pause",
    })) as HTMLButtonElement;

    expect(deposit.disabled).toBe(true);
    expect(withdraw.disabled).toBe(true);
    expect(pause.disabled).toBe(true);
  });

  it("labels and scales amounts with the token's own metadata", async () => {
    // A 6-decimal token: 50_000_000 smallest units is 50, not 5. Reading it as
    // XLM is the bug this page used to have.
    payflowMock.readContract.mockImplementation(async (_id: string, method: string) =>
      method === "symbol" ? "USDC" : 6,
    );
    payflowMock.vaultBalance.mockResolvedValue(50_000_000n);
    apiMock.mandatesOf.mockResolvedValue({ mandates: [mandate()] });

    render(<AccountPage />);

    expect(await screen.findByText("50 USDC")).toBeTruthy();
    expect(await screen.findByText(/10 USDC per month/)).toBeTruthy();
    expect(screen.getByLabelText("Amount (USDC)")).toBeTruthy();
    expect(payflowMock.readContract).toHaveBeenCalledWith(
      expect.any(String),
      "decimals",
      expect.any(String),
    );
  });

  it("still shows amounts when the token's metadata cannot be read", async () => {
    payflowMock.readContract.mockRejectedValue(new Error("host error: missing contract"));
    payflowMock.vaultBalance.mockResolvedValue(50_000_000n);
    apiMock.mandatesOf.mockResolvedValue({ mandates: [mandate()] });

    render(<AccountPage />);

    // Degrades to the native assumption rather than blanking the page.
    expect(await screen.findByText("5 XLM")).toBeTruthy();
  });
});
