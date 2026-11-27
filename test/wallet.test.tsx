// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNATURE_CANCELLED_MESSAGE } from "@/lib/signature-error";
import {
  ACCOUNT_CHANGED_ERROR,
  RECONNECT_DISCONNECTED_ERROR,
  STORAGE_KEY,
  WalletProvider,
  checkNetworkMismatch,
  parseStoredSession,
  resolveReconnectSession,
  serializeSession,
  setKitPromiseForTesting,
  shouldUpdateAddress,
  updateStoredSessionAddress,
  useWallet,
} from "@/lib/wallet";
import { merchantAuthToken } from "@/lib/sep10";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";

const ADDRESS_A = "GAEWDXVDI3WI35TWTZXNQ4NTRYIG6J34XPRSNKX655LBA377M5ZOCBY5";
const ADDRESS_B = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";
const WALLET_ID = "freighter";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

// The provider reads the native balance whenever the address changes; these
// cases are about the address, so Horizon is never really asked.
vi.mock("@/lib/account", () => ({
  readNativeAccount: vi.fn(async () => ({ state: "missing" as const })),
  fundWithFriendbot: vi.fn(async () => {}),
}));

vi.mock("@/lib/config", () => ({
  config: {
    networkPassphrase: "Test SDF Network ; September 2015",
  },
}));

describe("wallet pure functions", () => {
  describe("checkNetworkMismatch", () => {
    it("returns false when wallet network is null or unknown", () => {
      expect(checkNetworkMismatch(null, TESTNET_PASSPHRASE)).toBe(false);
    });

    it("returns false when wallet network matches configured passphrase", () => {
      expect(checkNetworkMismatch(TESTNET_PASSPHRASE, TESTNET_PASSPHRASE)).toBe(false);
    });

    it("returns true when wallet network differs from configured passphrase", () => {
      expect(checkNetworkMismatch(PUBLIC_PASSPHRASE, TESTNET_PASSPHRASE)).toBe(true);
    });
  });

  describe("shouldUpdateAddress", () => {
    it("returns false when current address is null (no wallet connected)", () => {
      expect(shouldUpdateAddress(null, ADDRESS_A)).toBe(false);
    });

    it("returns false when detected address is null or undefined", () => {
      expect(shouldUpdateAddress(ADDRESS_A, null)).toBe(false);
      expect(shouldUpdateAddress(ADDRESS_A, undefined)).toBe(false);
    });

    it("returns false when current address and detected address match", () => {
      expect(shouldUpdateAddress(ADDRESS_A, ADDRESS_A)).toBe(false);
    });

    it("returns true when detected address differs from current address", () => {
      expect(shouldUpdateAddress(ADDRESS_A, ADDRESS_B)).toBe(true);
    });
  });

  describe("session storage helpers", () => {
    it("parses valid session JSON", () => {
      const raw = JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A });
      expect(parseStoredSession(raw)).toEqual({
        walletId: WALLET_ID,
        address: ADDRESS_A,
      });
    });

    it("returns null for invalid or corrupted session JSON", () => {
      expect(parseStoredSession(null)).toBeNull();
      expect(parseStoredSession("")).toBeNull();
      expect(parseStoredSession("not-json")).toBeNull();
      expect(parseStoredSession(JSON.stringify({ walletId: 123 }))).toBeNull();
      expect(parseStoredSession(JSON.stringify({ address: ADDRESS_A }))).toBeNull();
    });

    it("serializes session accurately", () => {
      expect(serializeSession(WALLET_ID, ADDRESS_A)).toBe(
        JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A }),
      );
    });

    it("updates address in stored session while preserving wallet ID", () => {
      const raw = JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A });
      const updated = updateStoredSessionAddress(raw, ADDRESS_B);
      expect(parseStoredSession(updated)).toEqual({
        walletId: WALLET_ID,
        address: ADDRESS_B,
      });
    });

    it("returns null when updating an invalid session string", () => {
      expect(updateStoredSessionAddress(null, ADDRESS_B)).toBeNull();
      expect(updateStoredSessionAddress("invalid", ADDRESS_B)).toBeNull();
    });

    it("resolves reconnect session from storage or in-memory fallback", () => {
      expect(resolveReconnectSession(null, null, null)).toBeNull();
      expect(resolveReconnectSession("bad-json", null, null)).toBeNull();
      expect(
        resolveReconnectSession(
          JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A }),
          null,
          null,
        ),
      ).toEqual({ walletId: WALLET_ID, address: ADDRESS_A });
      expect(resolveReconnectSession(null, WALLET_ID, ADDRESS_A)).toEqual({
        walletId: WALLET_ID,
        address: ADDRESS_A,
      });
      expect(resolveReconnectSession(null, null, ADDRESS_A)).toEqual({
        walletId: "",
        address: ADDRESS_A,
      });
    });
  });
});

describe("WalletProvider and account change detection", () => {
  const mockKit = {
    setWallet: vi.fn(),
    getAddress: vi.fn(),
    getNetwork: vi.fn(),
    signTransaction: vi.fn(),
    openModal: vi.fn(),
    disconnect: vi.fn(),
  };

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mockKit.getNetwork.mockResolvedValue({ networkPassphrase: TESTNET_PASSPHRASE });
    setKitPromiseForTesting(Promise.resolve(mockKit as unknown as StellarWalletsKit));
  });

  afterEach(() => {
    cleanup();
    setKitPromiseForTesting(null);
  });

  function TestConsumer() {
    const { address, error, networkMismatch, signXdr, disconnect } = useWallet();
    return (
      <div>
        <div data-testid="address">{address ?? "disconnected"}</div>
        <div data-testid="mismatch">{networkMismatch ? "mismatch" : "matched"}</div>
        {error && <div data-testid="error">{error}</div>}
        <button
          type="button"
          data-testid="sign-btn"
          onClick={() => void signXdr("AAAA").catch(() => {})}
        >
          Sign
        </button>
        <button type="button" data-testid="disconnect-btn" onClick={() => void disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  it("restores saved session on mount and detects if account changed while away", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A }),
    );
    // While away, user switched to ADDRESS_B in wallet extension
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_B });

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    expect(await screen.findByText(ADDRESS_B)).toBeTruthy();
    expect(mockKit.setWallet).toHaveBeenCalledWith(WALLET_ID);
    // localStorage should be updated with new address
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(ADDRESS_B);
  });

  it("notices when the wallet's account changes on window focus and updates UI", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A }),
    );
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_A });

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    expect(await screen.findByText(ADDRESS_A)).toBeTruthy();

    // User switches account inside wallet extension to ADDRESS_B
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_B });

    // Focus returns to the browser tab
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    // UI updates with the new address
    expect(await screen.findByText(ADDRESS_B)).toBeTruthy();
    // localStorage updated with new address
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(ADDRESS_B);
  });

  it("notices when the wallet's account changes on document visibility change", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A }),
    );
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_A });

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    expect(await screen.findByText(ADDRESS_A)).toBeTruthy();

    // User switches account to ADDRESS_B
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_B });

    // Tab becomes visible again
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(await screen.findByText(ADDRESS_B)).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(ADDRESS_B);
  });

  it("does not query wallet when no wallet is connected", async () => {
    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    expect(screen.getByTestId("address").textContent).toBe("disconnected");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(mockKit.getAddress).not.toHaveBeenCalled();
    expect(screen.getByTestId("address").textContent).toBe("disconnected");
  });

  it("re-reads address before signing and throws if account changed", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A }),
    );
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_A });
    mockKit.signTransaction.mockResolvedValue({ signedTxXdr: "SIGNED_XDR" });

    let capturedSignXdr!: (xdr: string) => Promise<string>;

    function SignConsumer() {
      const { signXdr, address } = useWallet();
      capturedSignXdr = signXdr;
      return <div data-testid="address">{address}</div>;
    }

    render(
      <WalletProvider>
        <SignConsumer />
      </WalletProvider>,
    );

    expect(await screen.findByText(ADDRESS_A)).toBeTruthy();

    // Successful sign when address hasn't changed
    const res = await capturedSignXdr("UNISGNED_XDR");
    expect(res).toBe("SIGNED_XDR");

    // User switched account to ADDRESS_B right before next signature
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_B });

    // Attempting to sign now should reject and update UI
    await expect(capturedSignXdr("UNSIGNED_XDR_2")).rejects.toThrow(
      ACCOUNT_CHANGED_ERROR,
    );

    // Context address must have updated to ADDRESS_B
    expect(await screen.findByText(ADDRESS_B)).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(ADDRESS_B);
  });

  it.each([
    ["Freighter", new Error("The user rejected this request.")],
    [
      "Albedo",
      { message: "Action request was rejected by the user.", code: -4 },
    ],
  ])("replaces a %s signature rejection with a friendly message", async (_wallet, rejection) => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A }),
    );
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_A });
    mockKit.signTransaction.mockRejectedValue(rejection);

    let capturedSignXdr!: (xdr: string) => Promise<string>;

    function SignConsumer() {
      const { signXdr, address } = useWallet();
      capturedSignXdr = signXdr;
      return <div data-testid="address">{address}</div>;
    }

    render(
      <WalletProvider>
        <SignConsumer />
      </WalletProvider>,
    );

    expect(await screen.findByText(ADDRESS_A)).toBeTruthy();
    await expect(capturedSignXdr("UNSIGNED_XDR")).rejects.toThrow(
      SIGNATURE_CANCELLED_MESSAGE,
    );
  });

  it("keeps a wallet error that is not a cancellation", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A }),
    );
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_A });
    mockKit.signTransaction.mockRejectedValue(
      new Error("The wallet encountered an internal error. Please try again."),
    );

    let capturedSignXdr!: (xdr: string) => Promise<string>;

    function SignConsumer() {
      const { signXdr, address } = useWallet();
      capturedSignXdr = signXdr;
      return <div data-testid="address">{address}</div>;
    }

    render(
      <WalletProvider>
        <SignConsumer />
      </WalletProvider>,
    );

    expect(await screen.findByText(ADDRESS_A)).toBeTruthy();
    await expect(capturedSignXdr("UNSIGNED_XDR")).rejects.toThrow(
      "The wallet encountered an internal error. Please try again.",
    );
  });

  it("updates WalletButton UI when mocked account switch occurs", async () => {
    const { WalletButton } = await import("@/components/WalletButton");
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A }),
    );
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_A });

    render(
      <WalletProvider>
        <WalletButton />
      </WalletProvider>,
    );

    // Wait for initial session restore
    expect(await screen.findByText(/GAEWD/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy connected wallet address" }).title).toBe(ADDRESS_A);

    // Switch account in wallet
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_B });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    const updated = await screen.findByText(/GAP6Q/);
    expect(updated).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy connected wallet address" }).title).toBe(ADDRESS_B);
  });



  it("triggers data reloading in consumers when account changes", async () => {
    const loadMock = vi.fn();

    function DataConsumer() {
      const { address } = useWallet();

      useEffect(() => {
        if (address) {
          loadMock(address);
        }
      }, [address]);

      return <div data-testid="active-user">{address ? `User: ${address}` : "No user"}</div>;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A }),
    );
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_A });

    render(
      <WalletProvider>
        <DataConsumer />
      </WalletProvider>,
    );

    expect(await screen.findByText(`User: ${ADDRESS_A}`)).toBeTruthy();
    await waitFor(() => expect(loadMock).toHaveBeenCalledWith(ADDRESS_A));

    // Mock account switch in extension
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_B });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(await screen.findByText(`User: ${ADDRESS_B}`)).toBeTruthy();
    await waitFor(() => expect(loadMock).toHaveBeenCalledWith(ADDRESS_B));
  });

  it("handles wallet getAddress error gracefully on focus without clearing state", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A }),
    );
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_A });

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    expect(await screen.findByText(ADDRESS_A)).toBeTruthy();

    // Wallet is locked or extension temporarily throws
    mockKit.getAddress.mockRejectedValue(new Error("Wallet locked"));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    // Address remains ADDRESS_A and does not crash
    expect(screen.getByTestId("address").textContent).toBe(ADDRESS_A);
  });

  it("clears address and storage on disconnect", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ walletId: WALLET_ID, address: ADDRESS_A }),
    );
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_A });

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    );

    expect(await screen.findByText(ADDRESS_A)).toBeTruthy();

    await act(async () => {
      screen.getByTestId("disconnect-btn").click();
    });

    expect(screen.getByTestId("address").textContent).toBe("disconnected");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});


describe("WalletProvider connection and signing lifecycle", () => {
  const kit = {
    setWallet: vi.fn(),
    getAddress: vi.fn(),
    getNetwork: vi.fn(),
    signTransaction: vi.fn(),
    openModal: vi.fn(),
    disconnect: vi.fn(),
  };

  function mountWallet() {
    return renderHook(() => useWallet(), { wrapper: WalletProvider });
  }

  beforeEach(() => {
    window.localStorage.clear();
    vi.resetAllMocks();
    kit.getAddress.mockResolvedValue({ address: ADDRESS_A });
    kit.getNetwork.mockResolvedValue({ networkPassphrase: TESTNET_PASSPHRASE });
    kit.signTransaction.mockResolvedValue({ signedTxXdr: "SIGNED_XDR" });
    kit.disconnect.mockResolvedValue(undefined);
    kit.openModal.mockImplementation(async ({ onWalletSelected }) => {
      await onWalletSelected({ id: WALLET_ID });
    });
    setKitPromiseForTesting(Promise.resolve(kit as unknown as StellarWalletsKit));
  });

  afterEach(() => {
    cleanup();
    setKitPromiseForTesting(null);
    window.localStorage.clear();
  });

  it("starts disconnected without prompting or querying a wallet", () => {
    const { result } = mountWallet();
    expect(result.current.address).toBeNull();
    expect(result.current.connecting).toBe(false);
    expect(kit.openModal).not.toHaveBeenCalled();
    expect(kit.getAddress).not.toHaveBeenCalled();
  });

  it("connects through the selected wallet and persists its public session", async () => {
    const { result } = mountWallet();
    await act(async () => result.current.connect());
    expect(kit.setWallet).toHaveBeenCalledWith(WALLET_ID);
    expect(result.current.address).toBe(ADDRESS_A);
    expect(result.current.walletNetwork).toBe(TESTNET_PASSPHRASE);
    expect(result.current.connecting).toBe(false);
    expect(result.current.error).toBeNull();
    expect(parseStoredSession(localStorage.getItem(STORAGE_KEY))).toEqual({
      walletId: WALLET_ID,
      address: ADDRESS_A,
    });
  });

  it("stays connecting until the modal closes without a selection", async () => {
    let close: (() => void) | undefined;
    kit.openModal.mockImplementationOnce(async ({ onClosed }) => { close = onClosed; });
    const { result } = mountWallet();
    await act(async () => result.current.connect());
    expect(result.current.connecting).toBe(true);
    act(() => close?.());
    expect(result.current.connecting).toBe(false);
    expect(result.current.address).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("reports a modal failure and allows retrying the connection", async () => {
    kit.openModal.mockRejectedValueOnce(new Error("Wallet unavailable"));
    const { result } = mountWallet();
    await act(async () => result.current.connect());
    expect(result.current.error).toBe("Wallet unavailable");
    expect(result.current.connecting).toBe(false);
    expect(result.current.address).toBeNull();
    await act(async () => result.current.connect());
    expect(result.current.address).toBe(ADDRESS_A);
    expect(result.current.error).toBeNull();
  });

  it("does not store a session when reading the selected account fails", async () => {
    kit.getAddress.mockRejectedValueOnce(new Error("Account locked"));
    const { result } = mountWallet();
    await act(async () => result.current.connect());
    expect(result.current.error).toBe("Account locked");
    expect(result.current.connecting).toBe(false);
    expect(result.current.address).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("removes corrupt stored sessions without opening the wallet modal", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    const { result } = mountWallet();
    expect(result.current.address).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(kit.openModal).not.toHaveBeenCalled();
    expect(kit.setWallet).not.toHaveBeenCalled();
  });

  it("restores a session silently and exposes the wallet's network mismatch", async () => {
    localStorage.setItem(STORAGE_KEY, serializeSession(WALLET_ID, ADDRESS_A));
    kit.getNetwork.mockResolvedValue({ networkPassphrase: PUBLIC_PASSPHRASE });
    const { result } = mountWallet();
    await waitFor(() => expect(result.current.networkMismatch).toBe(true));
    expect(result.current.address).toBe(ADDRESS_A);
    expect(result.current.walletNetwork).toBe(PUBLIC_PASSPHRASE);
    expect(kit.openModal).not.toHaveBeenCalled();
    await expect(result.current.signXdr("UNSIGNED")).rejects.toThrow("correct network");
    expect(kit.signTransaction).not.toHaveBeenCalled();
  });

  it("rechecks the wallet network immediately before signing", async () => {
    kit.getNetwork
      .mockResolvedValueOnce({ networkPassphrase: TESTNET_PASSPHRASE })
      .mockResolvedValueOnce({ networkPassphrase: PUBLIC_PASSPHRASE });
    const { result } = mountWallet();
    await act(async () => result.current.connect());

    await expect(result.current.signXdr("UNSIGNED")).rejects.toThrow("correct network");
    await waitFor(() => expect(result.current.networkMismatch).toBe(true));
    expect(kit.signTransaction).not.toHaveBeenCalled();
  });

  it("shows an action explanation and only opens the wallet after confirmation", async () => {
    const { result } = mountWallet();
    await act(async () => result.current.connect());

    let signing!: Promise<string>;
    act(() => {
      signing = result.current.signXdr("UNSIGNED", "deposit tokens into a vault");
    });

    const dialog = await screen.findByRole("dialog", { name: "Review this wallet action?" });
    expect(dialog.textContent).toContain(
      "This transaction will deposit tokens into a vault.",
    );
    expect(kit.signTransaction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
    await expect(signing).resolves.toBe("SIGNED_XDR");
    expect(kit.signTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not ask the wallet to sign when the action explanation is cancelled", async () => {
    const { result } = mountWallet();
    await act(async () => result.current.connect());

    let signing!: Promise<string>;
    act(() => {
      signing = result.current.signXdr("UNSIGNED", "deposit tokens into a vault");
    });
    await screen.findByRole("dialog", { name: "Review this wallet action?" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await expect(signing).rejects.toThrow(SIGNATURE_CANCELLED_MESSAGE);
    expect(kit.signTransaction).not.toHaveBeenCalled();
  });

  it("rejects signing while disconnected before accessing the wallet", async () => {
    const { result } = mountWallet();
    await expect(result.current.signXdr("UNSIGNED")).rejects.toThrow("Connect a wallet first");
    expect(kit.getAddress).not.toHaveBeenCalled();
    expect(kit.signTransaction).not.toHaveBeenCalled();
  });

  it("passes the configured network and active public address when signing", async () => {
    const { result } = mountWallet();
    await act(async () => result.current.connect());
    await expect(result.current.signXdr("UNSIGNED")).resolves.toBe("SIGNED_XDR");
    expect(kit.signTransaction).toHaveBeenCalledWith("UNSIGNED", {
      networkPassphrase: TESTNET_PASSPHRASE,
      address: ADDRESS_A,
    });
  });

  it("propagates account-read errors without requesting a signature", async () => {
    const { result } = mountWallet();
    await act(async () => result.current.connect());
    kit.getAddress.mockRejectedValueOnce(new Error("Extension disconnected"));
    await expect(result.current.signXdr("UNSIGNED")).rejects.toThrow("Extension disconnected");
    expect(kit.signTransaction).not.toHaveBeenCalled();
  });

  it("clears session and mismatch even when the wallet cannot disconnect", async () => {
    kit.getNetwork.mockResolvedValue({ networkPassphrase: PUBLIC_PASSPHRASE });
    const { result } = mountWallet();
    await act(async () => result.current.connect());
    expect(result.current.networkMismatch).toBe(true);
    kit.disconnect.mockRejectedValueOnce(new Error("Disconnect is unsupported"));
    await act(async () => result.current.disconnect());
    expect(result.current.address).toBeNull();
    expect(result.current.walletNetwork).toBeNull();
    expect(result.current.networkMismatch).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("removes account-change listeners when the provider unmounts", async () => {
    const { result, unmount } = mountWallet();
    await act(async () => result.current.connect());
    unmount();
    kit.getAddress.mockClear();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(kit.getAddress).not.toHaveBeenCalled();
  });

  it("re-establishes the wallet session on visibility resume without a full reload", async () => {
    localStorage.setItem(STORAGE_KEY, serializeSession(WALLET_ID, ADDRESS_A));
    const { result } = mountWallet();
    await waitFor(() => expect(result.current.address).toBe(ADDRESS_A));

    kit.setWallet.mockClear();
    kit.getAddress.mockClear();
    kit.getNetwork.mockResolvedValue({ networkPassphrase: PUBLIC_PASSPHRASE });

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(kit.setWallet).toHaveBeenCalledWith(WALLET_ID);
    expect(kit.getAddress).toHaveBeenCalled();
    expect(result.current.networkMismatch).toBe(true);
    expect(result.current.reconnecting).toBe(false);
    expect(result.current.reconnectError).toBeNull();
  });

  it("exposes loading and error states while reconnecting and recovers on retry", async () => {
    const { WalletButton } = await import("@/components/WalletButton");
    localStorage.setItem(STORAGE_KEY, serializeSession(WALLET_ID, ADDRESS_A));

    let resolveReconnect!: (value: { address: string }) => void;
    kit.getAddress.mockResolvedValueOnce({ address: ADDRESS_A });

    render(
      <WalletProvider>
        <WalletButton />
      </WalletProvider>,
    );

    expect(await screen.findByText(/GAEWD/)).toBeTruthy();
    await screen.findByRole("button", { name: "Copy connected wallet address" });
    expect(screen.getByRole("button", { name: "Copy connected wallet address" }).title).toBe(ADDRESS_A);

    // Simulate failed background resume first
    kit.getAddress.mockRejectedValueOnce(new Error("Extension locked"));
    await act(async () => {
      window.dispatchEvent(new Event("pageshow"));
    });

    const alertEl = await screen.findByRole("alert");
    expect(alertEl.textContent).toContain("Session needs reconnect");
    expect(alertEl.className).toContain("text-warn");

    // Retry reconnect via button: verify loading state then active state
    kit.getAddress.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReconnect = resolve;
        }),
    );

    const retryButton = screen.getByRole("button", { name: "Reconnect wallet session" });
    act(() => {
      retryButton.click();
    });

    const statusEl = await screen.findByRole("status");
    expect(statusEl.getAttribute("aria-busy")).toBe("true");
    expect(statusEl.textContent).toContain("Reconnecting…");

    await act(async () => {
      resolveReconnect({ address: ADDRESS_A });
    });

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("button", { name: "Copy connected wallet address" }).title).toBe(ADDRESS_A);
  });

  it("sets reconnectError when wallet returns an empty address on resume", async () => {
    localStorage.setItem(STORAGE_KEY, serializeSession(WALLET_ID, ADDRESS_A));
    const { result } = mountWallet();
    await waitFor(() => expect(result.current.address).toBe(ADDRESS_A));

    kit.getAddress.mockResolvedValueOnce({ address: "" });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(result.current.reconnectError).toBe(RECONNECT_DISCONNECTED_ERROR);
    expect(result.current.address).toBe(ADDRESS_A);
  });

  it("configures merchant auth token provider only for connected account", async () => {
    localStorage.setItem(STORAGE_KEY, serializeSession(WALLET_ID, ADDRESS_A));
    const { result } = mountWallet();
    await waitFor(() => expect(result.current.address).toBe(ADDRESS_A));

    expect(await merchantAuthToken(ADDRESS_B)).toBeNull();
  });
});
