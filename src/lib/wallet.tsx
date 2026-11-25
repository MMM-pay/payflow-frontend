"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  lazy,
  useMemo,
  useRef,
  Suspense,
  useState,
  type ReactNode,
} from "react";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { config } from "./config";
import { createWalletModules } from "./wallet-modules";
import type { SignXdr } from "./payflow";
import { SIGNATURE_CANCELLED_MESSAGE, translateSignatureError } from "./signature-error";
import { fundWithFriendbot, readNativeAccount, type NativeAccount } from "./account";
import {
  clearMerchantSession,
  getMerchantToken,
  merchantSession,
  setMerchantTokenProvider,
} from "./sep10";

const SigningExplanationDialog = lazy(() =>
  import("@/components/SigningExplanationDialog").then(
    (module) => ({ default: module.SigningExplanationDialog }),
  ),
);

export const STORAGE_KEY = "payflow.wallet";
export const ACCOUNT_CHANGED_ERROR =
  "Wallet account changed. Please retry the transaction with the new account.";

export interface StoredSession {
  walletId: string;
  address: string;
}

export function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed?.walletId === "string" && typeof parsed?.address === "string") {
      return { walletId: parsed.walletId, address: parsed.address };
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeSession(walletId: string, address: string): string {
  return JSON.stringify({ walletId, address });
}

export function updateStoredSessionAddress(
  raw: string | null,
  newAddress: string,
): string | null {
  const session = parseStoredSession(raw);
  if (!session) return null;
  return serializeSession(session.walletId, newAddress);
}

export function checkNetworkMismatch(
  walletNetwork: string | null,
  targetPassphrase = config.networkPassphrase,
): boolean {
  if (!walletNetwork) return false;
  return walletNetwork !== targetPassphrase;
}

export function shouldUpdateAddress(
  currentAddress: string | null,
  detectedAddress: string | null | undefined,
): boolean {
  if (!currentAddress || !detectedAddress) return false;
  return currentAddress !== detectedAddress;
}

/**
 * What the header knows about the connected account's native balance.
 *
 * `missing` (the network has no such account) is kept apart from `error` (we
 * could not ask): only the first means "this needs funding".
 */
export type AccountState =
  | { state: "loading" }
  | { state: "loaded"; account: NativeAccount }
  | { state: "missing" }
  | { state: "error"; message: string };

export interface WalletState {
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

export async function getKit(): Promise<StellarWalletsKit> {
  if (!kitPromise) {
    kitPromise = (async () => {
      const mod = await import("@creit.tech/stellar-wallets-kit");
      const network = config.networkPassphrase as (typeof mod.WalletNetwork)[keyof typeof mod.WalletNetwork];
      const modules = await createWalletModules(mod.allowAllModules, {
        projectId: config.walletConnectProjectId,
        network,
        appUrl: typeof window !== "undefined"
        ? `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`
        : process.env.NEXT_PUBLIC_BASE_PATH ?? "/",
      });
      return new mod.StellarWalletsKit({ network, modules });
    })();
  }
  return kitPromise;
}

/**
 * Injects a kit instance for testing.
 */
export function setKitPromiseForTesting(p: Promise<StellarWalletsKit> | null) {
  kitPromise = p;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletNetwork, setWalletNetwork] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountState>({ state: "loading" });
  const [funding, setFunding] = useState(false);
  const [signingDescription, setSigningDescription] = useState<string | null>(null);
  const signingDecisionRef = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);

  const requestSigningConfirmation = useCallback((description: string) => {
    return new Promise<void>((resolve, reject) => {
      if (signingDecisionRef.current) {
        reject(new Error("A wallet signing request is already awaiting confirmation."));
        return;
      }
      signingDecisionRef.current = { resolve, reject };
      setSigningDescription(description);
    });
  }, []);

  const decideSigning = useCallback((approved: boolean) => {
    const decision = signingDecisionRef.current;
    if (!decision) return;
    signingDecisionRef.current = null;
    setSigningDescription(null);
    if (approved) decision.resolve();
    else decision.reject(new Error(SIGNATURE_CANCELLED_MESSAGE));
  }, []);

  useEffect(() => () => {
    const decision = signingDecisionRef.current;
    signingDecisionRef.current = null;
    decision?.reject(new Error(SIGNATURE_CANCELLED_MESSAGE));
  }, []);

  // Keep a ref of the current address to avoid stale closures in event listeners
  // and async callbacks. Every setter below already writes the ref alongside the
  // state, so this effect only keeps them in step for addresses that reach the
  // state some other way. Refs are not written during render (react-hooks/refs).
  const addressRef = useRef<string | null>(address);
  useEffect(() => {
    addressRef.current = address;
  }, [address]);

  // False once the provider has unmounted, so a lookup that resolves later
  // does not set state on a provider that is gone.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Track in-flight checks to prevent duplicate concurrent queries.
  const syncingRef = useRef(false);

  /**
   * Read the native balance of whichever address is connected. Called on
   * connect and after anything that moves XLM; a disconnected wallet reads
   * nothing, so no address is ever sent to Horizon without a session.
   */
  const refreshAccount = useCallback(async () => {
    const current = addressRef.current;
    if (!current) {
      setAccount({ state: "loading" });
      return;
    }
    const result = await readNativeAccount(current);
    if (!mountedRef.current) return; // the provider unmounted meanwhile
    if (addressRef.current !== current) return; // the wallet switched meanwhile
    if (result.state === "found") {
      setAccount({ state: "loaded", account: result.account });
    } else if (result.state === "missing") {
      setAccount({ state: "missing" });
    } else {
      setAccount({ state: "error", message: result.message });
    }
  }, []);

  useEffect(() => {
    void refreshAccount();
  }, [address, refreshAccount]);

  /**
   * Ask Friendbot to create the account, then re-read it: the balance only
   * exists once Friendbot has funded it. A refusal is surfaced through the
   * usual error channel rather than thrown at the click handler.
   */
  const fund = useCallback(async () => {
    const current = addressRef.current;
    if (!current || funding) return;
    setFunding(true);
    setError(null);
    try {
      await fundWithFriendbot(current);
      await refreshAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFunding(false);
    }
  }, [funding, refreshAccount]);

  const networkMismatch = useMemo(
    () => checkNetworkMismatch(walletNetwork),
    [walletNetwork],
  );

  const applyAccountChange = useCallback((newAddress: string) => {
    addressRef.current = newAddress;
    setAddress(newAddress);
    // The token was minted for the previous account; drop it now so a request
    // made for the new account cannot carry it. (The account-change effect
    // below clears again, but mid-flight calls run before it does.)
    clearMerchantSession();
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const updated = updateStoredSessionAddress(stored, newAddress);
    if (updated) {
      window.localStorage.setItem(STORAGE_KEY, updated);
    }
    // Re-check network mismatch for the new account
    void getKit().then(async (kit) => {
      try {
        const { networkPassphrase } = await kit.getNetwork();
        setWalletNetwork(networkPassphrase);
      } catch {
        setWalletNetwork(null);
      }
    });
  }, []);

  const checkAccount = useCallback(async () => {
    if (!addressRef.current || syncingRef.current) return;
    syncingRef.current = true;
    try {
      const kit = await getKit();
      const { address: detected } = await kit.getAddress();
      if (shouldUpdateAddress(addressRef.current, detected)) {
        applyAccountChange(detected);
      }
    } catch {
      // Wallet extension may be closed, locked, or busy; ignore background errors
    } finally {
      syncingRef.current = false;
    }
  }, [applyAccountChange]);

  // Restore the previous session without prompting the user again.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const session = parseStoredSession(stored);
    if (!session) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const { walletId, address: saved } = session;
    void getKit().then(async (kit) => {
      kit.setWallet(walletId);
      let activeAddress = saved;
      try {
        const { address: detected } = await kit.getAddress();
        if (detected) {
          activeAddress = detected;
          if (detected !== saved) {
            window.localStorage.setItem(
              STORAGE_KEY,
              serializeSession(walletId, detected),
            );
          }
        }
      } catch {
        // Wallet may be locked or not ready; keep saved
      }
      addressRef.current = activeAddress;
      setAddress(activeAddress);
      // Restore the network mismatch state for the restored session
      try {
        const { networkPassphrase } = await kit.getNetwork();
        setWalletNetwork(networkPassphrase);
      } catch {
        // Wallet may not support getNetwork; treat as no mismatch
        setWalletNetwork(null);
      }
    });
  }, []);

  // Re-read address on window focus or document visibility change. If the user
  // switched accounts in the wallet extension popup and returned to this tab,
  // update state and storage.
  useEffect(() => {
    if (!address) return;

    function onFocus() {
      void checkAccount();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void checkAccount();
      }
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [address, checkAccount]);

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
            addressRef.current = selected;
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
              serializeSession(option.id, selected),
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
    // Drop the SEP-10 session now: the wallet is gone, so the token must not
    // outlive it. The provider is also unbound by the account effect below.
    clearMerchantSession();
    addressRef.current = null;
    setAddress(null);
    setWalletNetwork(null);
  }, []);

  const signXdr = useCallback<SignXdr>(
    async (xdrString, description) => {
      if (!address) throw new Error("Connect a wallet first.");
      const kit = await getKit();

      // Wallet extensions can change networks without changing accounts. Read
      // the active network immediately before signing instead of trusting the
      // value captured when the session was restored or connected.
      let activeNetwork: string | null = null;
      try {
        const { networkPassphrase } = await kit.getNetwork();
        activeNetwork = networkPassphrase;
        setWalletNetwork(networkPassphrase);
      } catch {
        // Preserve the established behavior for wallets without getNetwork.
      }
      if (
        checkNetworkMismatch(activeNetwork) ||
        (!activeNetwork && networkMismatch)
      ) {
        throw new Error("Switch your wallet to the correct network first.");
      }

      // Re-read the address before signing. If the user switched accounts
      // in the wallet extension popup, the prepared transaction was built
      // for the previous address. Signing it would fail verification or act
      // on the wrong account.
      let currentAddress: string | null = null;
      try {
        const res = await kit.getAddress();
        currentAddress = res.address;
      } catch (err) {
        throw new Error(
          err instanceof Error ? err.message : "Could not read address from wallet.",
        );
      }

      if (shouldUpdateAddress(address, currentAddress)) {
        applyAccountChange(currentAddress!);
        throw new Error(ACCOUNT_CHANGED_ERROR);
      }

      if (description) await requestSigningConfirmation(description);

      try {
        const { signedTxXdr } = await kit.signTransaction(xdrString, {
          networkPassphrase: config.networkPassphrase,
          address,
        });
        return signedTxXdr;
      } catch (err) {
        translateSignatureError(err);
      }
    },
    [address, networkMismatch, applyAccountChange, requestSigningConfirmation],
  );

  // Bind the SEP-10 merchant-session token provider to the connected account,
  // and clear the in-memory session whenever the account changes or the wallet
  // disconnects. A token minted for the previous account must never be
  // attached to a request made after the change, so the previous session is
  // dropped before the new one is bound. The token itself lives only in the
  // module singleton (`merchantSession`), never in localStorage.
  useEffect(() => {
    if (!address) {
      clearMerchantSession();
      setMerchantTokenProvider(null);
      return;
    }
    clearMerchantSession();
    setMerchantTokenProvider((merchant) => {
      // Only sign for the connected account: a subscriber viewing a merchant's
      // page must not trigger a SEP-10 challenge for that merchant.
      if (merchant !== address) return Promise.resolve(null);
      return getMerchantToken(
        {
          address,
          signXdr,
          apiUrl: config.apiUrl,
          networkPassphrase: config.networkPassphrase,
        },
        merchantSession,
      );
    });
  }, [address, signXdr]);

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
      fund,
      refreshAccount,
      connect,
      disconnect,
      signXdr,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {signingDescription !== null && (
        <Suspense fallback={null}>
          <SigningExplanationDialog
            description={signingDescription}
            onCancel={() => decideSigning(false)}
            onConfirm={() => decideSigning(true)}
          />
        </Suspense>
      )}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside a WalletProvider");
  return ctx;
}
