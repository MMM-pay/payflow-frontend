// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNATURE_CANCELLED_MESSAGE } from "@/lib/signature-error";
import {
  ACCOUNT_CHANGED_ERROR,
  STORAGE_KEY,
  WalletProvider,
  checkNetworkMismatch,
  parseStoredSession,
  serializeSession,
  setKitPromiseForTesting,
  shouldUpdateAddress,
  updateStoredSessionAddress,
  useWallet,
} from "@/lib/wallet";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";

const ADDRESS_A = "GAEWDXVDI3WI35TWTZXNQ4NTRYIG6J34XPRSNKX655LBA377M5ZOCBY5";
const ADDRESS_B = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";
const WALLET_ID = "freighter";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

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
    expect(screen.getByRole("button").title).toBe(`${ADDRESS_A} — click to disconnect`);

    // Switch account in wallet
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_B });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    const updated = await screen.findByTitle(`${ADDRESS_B} — click to disconnect`, {}, { timeout: 3000 });
    expect(updated).toBeTruthy();
    expect(updated.textContent).toContain("GAP6Q");
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
    expect(loadMock).toHaveBeenCalledWith(ADDRESS_A);

    // Mock account switch in extension
    mockKit.getAddress.mockResolvedValue({ address: ADDRESS_B });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(await screen.findByText(`User: ${ADDRESS_B}`)).toBeTruthy();
    expect(loadMock).toHaveBeenCalledWith(ADDRESS_B);
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

