// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

/**
 * The header shows the connected account's native balance and offers Friendbot
 * when the account does not exist yet. The property under test is that "no
 * account" and "cannot reach Horizon" stay distinct states, because collapsing
 * them would send a funded account to a faucet it does not need.
 *
 * Stellar Wallets Kit is mocked: it registers browser custom elements on
 * construction, which no test environment needs.
 */

const readNativeAccount = vi.hoisted(() => vi.fn());
const fundWithFriendbot = vi.hoisted(() => vi.fn());
const kitMock = vi.hoisted(() => ({
  setWallet: vi.fn(),
  getNetwork: vi.fn().mockResolvedValue({ networkPassphrase: "Test SDF Network ; September 2015" }),
  getAddress: vi.fn(),
  openModal: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(),
  StellarWalletsKit: vi.fn(),
  allowAllModules: vi.fn(() => []),
  WalletNetwork: { PUBLIC: "PUBLIC", TESTNET: "TESTNET" },
}));
kitMock.StellarWalletsKit.mockImplementation(() => kitMock);

vi.mock("@/lib/account", () => ({ readNativeAccount, fundWithFriendbot }));
vi.mock("@creit.tech/stellar-wallets-kit", () => kitMock);

import { useWallet, WalletProvider } from "@/lib/wallet";

const ADDRESS = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";

/** Restores a session for ADDRESS, as a returning visitor would have. */
function connectSession(address: string | null = ADDRESS) {
  if (address) {
    window.localStorage.setItem(
      "payflow.wallet",
      JSON.stringify({ walletId: "test", address }),
    );
  } else {
    window.localStorage.removeItem("payflow.wallet");
  }
}

/**
 * Renders the provider and hands back a live view of its state.
 *
 * A getter rather than a value: every action here changes state, and a
 * snapshot taken before the action would still read "missing" afterwards.
 */
async function settle() {
  let latest: ReturnType<typeof useWallet> | null = null;
  function Probe() {
    latest = useWallet();
    return null;
  }
  await act(async () => {
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
  });
  // Let the account read settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    get current(): ReturnType<typeof useWallet> {
      if (!latest) throw new Error("probe never rendered");
      return latest;
    },
  };
}

beforeEach(() => {
  readNativeAccount.mockReset();
  fundWithFriendbot.mockReset();
  kitMock.getNetwork.mockResolvedValue({
    networkPassphrase: "Test SDF Network ; September 2015",
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("wallet account state", () => {
  it("reports the connected account's native balance", async () => {
    connectSession();
    readNativeAccount.mockResolvedValue({
      state: "found",
      account: { balance: 125_000_000n, subentryCount: 0 },
    });

    const wallet = await settle();
    expect(wallet.current.account).toEqual({
      state: "loaded",
      account: { balance: 125_000_000n, subentryCount: 0 },
    });
  });

  it("reports an account the network does not know as missing", async () => {
    connectSession();
    readNativeAccount.mockResolvedValue({ state: "missing" });

    const wallet = await settle();
    expect(wallet.current.account).toEqual({ state: "missing" });
  });

  it("reports an unreachable Horizon as an error, never as missing", async () => {
    // A funded account must not be pushed towards the faucet because Horizon
    // happened to be down.
    connectSession();
    readNativeAccount.mockResolvedValue({
      state: "unavailable",
      message: "Horizon returned 503.",
    });

    const wallet = await settle();
    expect(wallet.current.account).toEqual({ state: "error", message: "Horizon returned 503." });
  });

  it("re-reads the balance when refreshAccount is called", async () => {
    connectSession();
    readNativeAccount.mockResolvedValue({
      state: "found",
      account: { balance: 125_000_000n, subentryCount: 0 },
    });

    const wallet = await settle();
    expect(readNativeAccount).toHaveBeenCalledTimes(1);

    // What a deposit does: the native balance drops because of the fee.
    readNativeAccount.mockResolvedValue({
      state: "found",
      account: { balance: 124_999_500n, subentryCount: 0 },
    });
    await act(async () => {
      await wallet.current.refreshAccount();
    });

    expect(readNativeAccount).toHaveBeenCalledTimes(2);
  });

  it("funds with Friendbot and re-reads the balance afterwards", async () => {
    connectSession();
    readNativeAccount.mockResolvedValueOnce({ state: "missing" });
    fundWithFriendbot.mockResolvedValue(undefined);
    readNativeAccount.mockResolvedValue({
      state: "found",
      account: { balance: 10_000_000_000n, subentryCount: 0 },
    });

    const wallet = await settle();
    expect(wallet.current.account).toEqual({ state: "missing" });

    await act(async () => {
      await wallet.current.fund();
    });

    expect(fundWithFriendbot).toHaveBeenCalledWith(ADDRESS);
    // The balance has to be re-read: Friendbot only just created the account.
    expect(wallet.current.account).toEqual({
      state: "loaded",
      account: { balance: 10_000_000_000n, subentryCount: 0 },
    });
  });

  it("surfaces a failed funding attempt as an error rather than throwing", async () => {
    connectSession();
    readNativeAccount.mockResolvedValue({ state: "missing" });
    fundWithFriendbot.mockRejectedValue(new Error("Friendbot could not fund this account (it replied 503)."));

    const wallet = await settle();
    await act(async () => {
      await wallet.current.fund();
    });

    expect(wallet.current.error).toMatch(/Friendbot/);
  });

  it("does not read a balance while no wallet is connected", async () => {
    connectSession(null);
    readNativeAccount.mockResolvedValue({
      state: "found",
      account: { balance: 1n, subentryCount: 0 },
    });

    const wallet = await settle();
    expect(wallet.current.address).toBeNull();
    expect(readNativeAccount).not.toHaveBeenCalled();
  });

});
