"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { fundWithFriendbot, readNativeAccount, type NativeAccount } from "./account";
import { config } from "./config";
import type { SignXdr } from "./payflow";

const STORAGE_KEY = "payflow.wallet";

/** What the app knows about the connected account's native funds. */
export type AccountState =
  | { state: "loading" }
  | { state: "loaded"; account: NativeAccount }
  /** The account does not exist on the network yet; it needs funding. */
  | { state: "missing" }
  /** Horizon could not be reached or answered unusably. */
  | { state: "error"; message: string };

interface WalletState {
  address: string | null;
  connecting: boolean;
  error: string | null;
  networkMismatch: boolean;
  walletNetwork: string | null;
  /** Native balance and entry count, or why they are not known. */
  account: AccountState;
  /** True while a Friendbot request is in flight. */
  funding: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Re-reads the native balance. Safe to call after any transaction. */
  refreshAccount: () => Promise<void>;
  /** Creates and funds the account with Friendbot. Testnet only. */
  fund: () => Promise<void>;
  signXdr: SignXdr;
}

const WalletContext = createContext<WalletState | null>(null);

/**
 * The kit registers browser custom elements on construction, so it is imported
 * dynamically and only ever instantiated client-side. Building it at module
 * scope breaks the Next.js server render.
 */
let kitPromise: Promise<StellarWalletsKit> | null = null;

async function getKit(): Promise<StellarWalletsKit> {
  if (!kitPromise) {
    kitPromise = (async () => {
      const mod = await import("@creit.tech/stellar-wallets-kit");
      return new mod.StellarWalletsKit({
        network: config.networkPassphrase as unknown as (typeof mod.WalletNetwork)[keyof typeof mod.WalletNetwork],
        modules: mod.allowAllModules(),
      });
    })();
  }
  return kitPromise;
}

function checkNetworkMismatch(walletNetwork: string | null): boolean {
  if (!walletNetwork) return false;
  return walletNetwork !== config.networkPassphrase;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletNetwork, setWalletNetwork] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountState>({ state: "loading" });
  const [funding, setFunding] = useState(false);

  const networkMismatch = useMemo(
    () => checkNetworkMismatch(walletNetwork),
    [walletNetwork],
  );

  /**
   * Counts in-flight reads. A wallet can switch accounts mid-load, so a slow
   * read for the previous address must not overwrite the current one's state.
   */
  const readId = useRef(0);

  const loadAccount = useCallback(async (target: string | null) => {
    const id = (readId.current += 1);
    if (!target) {
      setAccount({ state: "loading" });
      return;
    }
    setAccount({ state: "loading" });
    const result = await readNativeAccount(target);
    if (id !== readId.current) return; // superseded by a newer read
    setAccount(
      result.state === "found"
        ? { state: "loaded", account: result.account }
        : result.state === "missing"
          ? { state: "missing" }
          : { state: "error", message: result.message },
    );
  }, []);

  useEffect(() => {
    void loadAccount(address);
  }, [address, loadAccount]);

  /** Re-read the native balance. Called after any transaction changes it. */
  const refreshAccount = useCallback(
    () => loadAccount(address),
    [address, loadAccount],
  );

  const fund = useCallback(async () => {
    if (!address) return;
    setFunding(true);
    try {
      await fundWithFriendbot(address);
      // Friendbot creates the account, so the balance must be re-read: the
      // first read may have raced ahead of the new ledger entry.
      await refreshAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fund this account.");
    } finally {
      setFunding(false);
    }
  }, [address, refreshAccount]);

  // Restore the previous session without prompting the user again.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      const { walletId, address: saved } = JSON.parse(stored) as {
        walletId: string;
        address: string;
      };
      void getKit().then(async (kit) => {
        kit.setWallet(walletId);
        setAddress(saved);
        // Restore the network mismatch state for the restored session
        try {
          const { networkPassphrase } = await kit.getNetwork();
          setWalletNetwork(networkPassphrase);
        } catch {
          // Wallet may not support getNetwork; treat as no mismatch
          setWalletNetwork(null);
        }
      });
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const kit = await getKit();
      await kit.openModal({
        onWalletSelected: async (option) => {
          try {
            kit.setWallet(option.id);
            const { address: selected } = await kit.getAddress();
            setAddress(selected);
            // Detect network mismatch after connection
            try {
              const { networkPassphrase } = await kit.getNetwork();
              setWalletNetwork(networkPassphrase);
            } catch {
              setWalletNetwork(null);
            }
            window.localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify({ walletId: option.id, address: selected }),
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not read address");
            setWalletNetwork(null);
          } finally {
            setConnecting(false);
          }
        },
        onClosed: () => setConnecting(false),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open wallet");
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const kit = await getKit();
    try {
      await kit.disconnect();
    } catch {
      // Some wallets have no disconnect concept; clearing local state is enough.
    }
    window.localStorage.removeItem(STORAGE_KEY);
    setAddress(null);
    setWalletNetwork(null);
  }, []);

  const signXdr = useCallback<SignXdr>(
    async (xdrString) => {
      if (!address) throw new Error("Connect a wallet first.");
      if (networkMismatch) throw new Error("Switch your wallet to the correct network first.");
      const kit = await getKit();
      const { signedTxXdr } = await kit.signTransaction(xdrString, {
        networkPassphrase: config.networkPassphrase,
        address,
      });
      return signedTxXdr;
    },
    [address, networkMismatch],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      connecting,
      error,
      networkMismatch,
      walletNetwork,
      account,
      funding,
      connect,
      disconnect,
      refreshAccount,
      fund,
      signXdr,
    }),
    [
      address,
      connecting,
      error,
      networkMismatch,
      walletNetwork,
      account,
      funding,
      connect,
      disconnect,
      refreshAccount,
      fund,
      signXdr,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside a WalletProvider");
  return ctx;
}
