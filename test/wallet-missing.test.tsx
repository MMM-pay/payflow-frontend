// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { setKitPromiseForTesting, useWallet, WalletProvider } from "@/lib/wallet";

vi.mock("@/lib/account", () => ({
  readNativeAccount: vi.fn().mockResolvedValue({ state: "missing" }),
  fundWithFriendbot: vi.fn(),
}));

const ADDRESS = `G${"A".repeat(55)}`;

const kit = {
  setWallet: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
  openModal: vi.fn(),
  disconnect: vi.fn(),
  getSupportedWallets: vi.fn(),
};

function Probe() {
  const { noWallet, connect, address } = useWallet();
  return (
    <div>
      <div data-testid="no-wallet">{noWallet ? "yes" : "no"}</div>
      <div data-testid="address">{address ?? "none"}</div>
      <button type="button" onClick={() => void connect()}>
        connect
      </button>
    </div>
  );
}

function setup() {
  render(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  );
}

async function clickConnect() {
  await act(async () => {
    screen.getByText("connect").click();
  });
}

describe("WalletProvider when no wallet is installed", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    kit.openModal.mockResolvedValue(undefined);
    kit.getNetwork.mockResolvedValue({ networkPassphrase: "Test SDF Network ; September 2015" });
    setKitPromiseForTesting(Promise.resolve(kit as unknown as StellarWalletsKit));
  });
  afterEach(() => {
    cleanup();
    setKitPromiseForTesting(null);
  });

  it("does not claim anything before the visitor tries to connect", () => {
    kit.getSupportedWallets.mockResolvedValue([{ id: "freighter", isAvailable: false }]);
    setup();
    expect(screen.getByTestId("no-wallet").textContent).toBe("no");
    expect(kit.getSupportedWallets).not.toHaveBeenCalled();
  });

  it("flags a missing wallet on connect, and still opens the wallet list", async () => {
    kit.getSupportedWallets.mockResolvedValue([
      { id: "freighter", isAvailable: false },
      { id: "albedo", isAvailable: true },
    ]);
    setup();
    await clickConnect();
    await waitFor(() => expect(screen.getByTestId("no-wallet").textContent).toBe("yes"));
    expect(kit.openModal).toHaveBeenCalledTimes(1);
  });

  it("does not flag anything when an extension wallet is present", async () => {
    kit.getSupportedWallets.mockResolvedValue([{ id: "freighter", isAvailable: true }]);
    setup();
    await clickConnect();
    expect(screen.getByTestId("no-wallet").textContent).toBe("no");
  });

  it("does not flag anything, and still connects, when detection fails", async () => {
    kit.getSupportedWallets.mockRejectedValue(new Error("unsupported"));
    setup();
    await clickConnect();
    expect(screen.getByTestId("no-wallet").textContent).toBe("no");
    expect(kit.openModal).toHaveBeenCalledTimes(1);
  });

  it("clears the flag once a wallet is connected", async () => {
    kit.getSupportedWallets.mockResolvedValue([{ id: "freighter", isAvailable: false }]);
    kit.getAddress.mockResolvedValue({ address: ADDRESS });
    kit.openModal.mockImplementation(
      async (opts: { onWalletSelected: (o: { id: string }) => Promise<void> }) => {
        await opts.onWalletSelected({ id: "albedo" });
      },
    );
    setup();
    await clickConnect();
    await waitFor(() => expect(screen.getByTestId("address").textContent).toBe(ADDRESS));
    expect(screen.getByTestId("no-wallet").textContent).toBe("no");
  });

  it("reports a wallet installed after the first attempt on the next connect", async () => {
    kit.getSupportedWallets.mockResolvedValueOnce([{ id: "freighter", isAvailable: false }]);
    setup();
    await clickConnect();
    await waitFor(() => expect(screen.getByTestId("no-wallet").textContent).toBe("yes"));
    kit.getSupportedWallets.mockResolvedValueOnce([{ id: "freighter", isAvailable: true }]);
    await clickConnect();
    await waitFor(() => expect(screen.getByTestId("no-wallet").textContent).toBe("no"));
  });
});
