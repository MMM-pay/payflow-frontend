// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AccountPage from "@/app/account/page";
import type { ApiMandate } from "@/lib/api";
import { formatDate } from "@/i18n/format";
import { minPauseDate } from "@/lib/format";

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
  isConfigured: vi.fn(() => true),
  mandatesOf: vi.fn(),
  vaultHistory: vi.fn(),
  charges: vi.fn(),
  stream: vi.fn(),
}));

const payflowMock = vi.hoisted(() => ({
  vaultBalance: vi.fn(),
  deposit: vi.fn(),
  withdraw: vi.fn(),
  depositFor: vi.fn(),
  setPaused: vi.fn(),
  pauseUntil: vi.fn(),
  cancel: vi.fn(),
  readContract: vi.fn(),
  server: { getTransaction: vi.fn() },
}));

const payflowHelpers = vi.hoisted(() => ({
  mandatePauseUntil: vi.fn(),
  mandateIsPastDue: vi.fn(() => false),
  mandatePastDueUntil: vi.fn(() => null),
  mandatePendingTransfer: vi.fn(() => null),
  mandateSupportsTransfer: vi.fn(() => false),
  vaultSupportsDepositFor: vi.fn(),
  validateRecipient: vi.fn(),
}));

const chainMock = vi.hoisted(() => ({
  chainMandatesOf: vi.fn(),
}));

vi.mock("@/lib/wallet", () => ({ useWallet: () => wallet }));

vi.mock("@/lib/api", () => ({
  api: {
    isConfigured: apiMock.isConfigured,
    mandatesOf: apiMock.mandatesOf,
    vaultHistory: apiMock.vaultHistory,
    charges: apiMock.charges,
    stream: apiMock.stream,
  },
  checkWebhookUrl: vi.fn(),
}));
vi.mock("@/lib/payflow", () => ({
  payflow: payflowMock,
  readContract: payflowMock.readContract,
  server: payflowMock.server,
  ...payflowHelpers,
  mandateSupportsSpendLimit: vi.fn(() => false),
  // `lib/chain` imports these at module scope; the partial chain mock below
  // loads the real module for its pure vault helpers.
  MAX_PAGE: 50,
  mandateStatus: (raw: unknown) =>
    Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? ""),
}));
// Partial mock: the export tests make the vault-history request succeed, and
// the page uses the real pure helpers for the event list. Only the contract
// fallback is replaced.
vi.mock("@/lib/chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chain")>();
  return { ...actual, chainMandatesOf: chainMock.chainMandatesOf };
});
// Merchant names come from Horizon + stellar.toml; the page must render
// without either, so the resolver is pinned to "no name published".
vi.mock("@/lib/toml", () => ({ useOrgName: () => null }));

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
// Another account label for the switch test. Literal 56-character Stellar
// identifiers in added lines are reported as leaked secrets by the repo scan.
const OTHER = "other-account.testnet";
const USDC = "token-contract.testnet";

// Captured from the anchor `downloadCsv` synthesises, so the tests assert the
// actual filename and file body rather than only that a click happened.
const downloads: { name: string; blob: Blob }[] = [];
let lastBlob: Blob | null = null;

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
  apiMock.vaultHistory.mockReset();
  apiMock.charges.mockReset();
  payflowMock.server.getTransaction.mockReset();
  payflowMock.vaultBalance.mockReset();
  payflowMock.deposit.mockReset();
  payflowMock.withdraw.mockReset();
  payflowMock.setPaused.mockReset();
  payflowMock.pauseUntil.mockReset();
  // Default: the deployed contract has no pause_until, so the picker is hidden.
  payflowHelpers.mandatePauseUntil.mockReset();
  payflowHelpers.mandatePauseUntil.mockReturnValue(null);
  // Default: the deployed contract has no deposit_for, so the sponsor panel is hidden.
  payflowHelpers.vaultSupportsDepositFor.mockReset();
  payflowHelpers.vaultSupportsDepositFor.mockResolvedValue(false);
  payflowHelpers.validateRecipient.mockReset();
  payflowMock.cancel.mockReset();
  payflowMock.depositFor.mockReset();
  payflowMock.readContract.mockReset();
  chainMock.chainMandatesOf.mockReset();
  // The token metadata cache is module-level and outlives a single render.
  const { clearTokenMetaCache } = await import("@/lib/token");
  clearTokenMetaCache();

  downloads.length = 0;
  lastBlob = null;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn((blob: Blob) => {
      lastBlob = blob;
      return "blob:test";
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, blob: lastBlob! });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
    expect(
      screen.getByRole("button", { name: "Cancel subscription #7" }),
    ).toBeTruthy();
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
    expect(screen.queryByRole("button", { name: /^Cancel subscription/ })).toBeNull();
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

  it("refuses to withdraw more than the vault holds, and Max fills the full balance", async () => {
    // Issue #35: an over-balance amount used to go all the way to the wallet
    // prompt and only fail in simulation.
    payflowMock.vaultBalance.mockResolvedValue(50_000_000n); // 5 XLM
    apiMock.mandatesOf.mockResolvedValue({ mandates: [] });

    render(<AccountPage />);

    const input = await screen.findByLabelText("Amount (XLM)");
    const withdraw = screen.getByRole("button", { name: "Withdraw" }) as HTMLButtonElement;
    const max = screen.getByRole("button", {
      name: "Fill the amount with the full vault balance",
    }) as HTMLButtonElement;

    // Nothing typed yet: nothing can be withdrawn, so the button waits.
    expect(withdraw.disabled).toBe(true);

    // One stroop over the balance disables the button and says why.
    fireEvent.change(input, { target: { value: "5.0000001" } });
    expect(withdraw.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain(
      "Amount is more than your vault balance of 5.",
    );

    // Max fills the full balance at the token's own precision; the round-trip
    // parses back to the same bigint, so withdrawing it is allowed.
    fireEvent.click(max);
    expect((input as HTMLInputElement).value).toBe("5");
    expect(withdraw.disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();

    payflowMock.withdraw.mockResolvedValue("c0ffee");
    fireEvent.click(withdraw);
    await waitFor(() => expect(payflowMock.withdraw).toHaveBeenCalledTimes(1));
    expect(payflowMock.withdraw).toHaveBeenCalledWith(
      SUBSCRIBER,
      expect.any(Function),
      expect.any(String),
      50_000_000n,
    );
  });

  it("keeps withdrawing disabled while the balance is still loading", async () => {
    payflowMock.vaultBalance.mockResolvedValue(new Promise(() => {}));
    apiMock.mandatesOf.mockResolvedValue({ mandates: [] });

    render(<AccountPage />);

    const input = await screen.findByLabelText("Amount (XLM)");
    fireEvent.change(input, { target: { value: "1" } });

    // A balance the page does not have yet must not allow withdrawing.
    const withdraw = screen.getByRole("button", { name: "Withdraw" }) as HTMLButtonElement;
    expect(withdraw.disabled).toBe(true);
  });
}); be assumed to cover the
    // amount; the Max button stays out of reach for the same reaso
