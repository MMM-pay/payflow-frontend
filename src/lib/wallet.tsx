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
import {
  SIGNATURE_CANCELLED_MESSAGE,
  isSignatureRejection,
  translateSignatureError,
} from "./signature-error";
import { detectMissingWallet } from "./wallet-detect";
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
export const RECONNECT_DISCONNECTED_ERROR =
  "Wallet session could not be restored. Reconnect your wallet.";

export interface StoredSession {
  walletId: string;
  address: string;
}

export type WalletNetworkStatus = "unknown" | "matching" | "mismatch";

export function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed?.walletId === "string" &&
      parsed.walletId.trim() &&
      typeof parsed.address === "string" &&
      parsed.address.trim()
    ) {
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

/**
 * Resolves the session that should be re-established when a backgrounded tab
 * regains focus, preferring the persisted session and falling back to the
 * in-memory connection when browser storage is unavailable.
 */
export function resolveReconnectSession(
  storedRaw: string | null,
  currentWalletId: string | null,
  currentAddress: string | null,
): StoredSession | null {
  const stored = parseStoredSession(storedRaw);
  if (stored) return stored;
  if (currentAddress) {
    return { walletId: currentWalletId ?? "", address: currentAddress };
  }
  return null;
}

function readStoredSessionRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredSessionRaw(value: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage is optional (e.g. private browsing).
  }
}

function removeStoredSessionRaw(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is optional.
  }
}

export function checkNetworkMismatch(
  walletNetwork: string | null,
  targetPassphrase = config.networkPassphrase,
): boolean {
  if (!walletNetwork) return false;
  return walletNetwork !== targetPassphrase;
}

export function getWalletNetworkStatus(
  walletNetwork: string | null,
  targetPassphrase = config.networkPassphrase,
): WalletNetworkStatus {
  if (!walletNetwork) return "unknown";
  return checkNetworkMismatch(walletNetwork, targetPassphrase) ? "mismatch" : "matching";
}

function getWalletStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function saveWalletSession(walletId: string, address: string): boolean {
  try {
    const storage = getWalletStorage();
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, serializeSession(walletId, address));
    return true;
  } catch {
    return false;
  }
}

function clearWalletSession(): boolean {
  try {
    const storage = getWalletStorage();
    if (!storage) return false;
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
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
  walletId: string | null;
  rememberedWalletId: string | null;
  walletSelectionLoaded: boolean;
  connecting: boolean;
  /** True while re-establishing a wallet session after the tab returns to focus. */
  reconnecting?: boolean;
  rememberedWalletId: string | null;
  walletSelectionLoaded: boolean;
  noWallet: boolean;
  /** True while a wallet modal is open or a signature request is in flight. */
  connectingWallet: boolean;
  error: string | null;
  /** Error surfaced if re-establishing the session on resume failed. */
  reconnectError?: string | null;
  networkMismatch: boolean;
  networkStatus: WalletNetworkStatus;
  walletNetwork: string | null;
  /** Native balance and entry count, or why they are not known. */
  account: AccountState;
  /** True while a Friendbot request is in flight. */
  funding: boolean;
  /** True while a signature is pending from the wallet. */
  signing: boolean;
  /** Error from the most recent signing attempt, if any. */
  signError: string | null;
  /** True while the wallet is locked or unresponsive. */
  locked: boolean;
  connect: () => Promise<void>;
  reconnect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Re-establishes the active wallet session without a full reload. */
  reconnect: () => Promise<void>;
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
  const [walletId, setWalletId] = useState<string | null>(null);
  const [rememberedWalletId, setRememberedWalletId] = useState<string | null>(null);
  const [walletSelectionLoaded, setWalletSelectionLoaded] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [rememberedWalletId, setRememberedWalletId] = useState<string | null>(null);
  const [walletSelectionLoaded, setWalletSelectionLoaded] = useState(false);
  const [noWallet, setNoWallet] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [walletNetwork, setWalletNetwork] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountState>({ state: "loading" });
  const [funding, setFunding] = useState(false);
  const activeWalletIdRef = useRef<string | null>(null);
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

  const networkStatus = address ? getWalletNetworkStatus(walletNetwork) : "unknown";
  const networkMismatch = networkStatus === "mismatch";

  const applyAccountChange = useCallback((newAddress: string) => {
    addressRef.current = newAddress;
    setAddress(newAddress);
    // The token was minted for the previous account; drop it now so a request
    // made for the new account cannot carry it. (The account-change effect
    // below clears again, but mid-flight calls run before it does.)
    clearMerchantSession();
    const stored = readStoredSessionRaw();
    const updated = updateStoredSessionAddress(stored, newAddress);
    if (updated) {
      writeStoredSessionRaw(updated);
    }
    // Re-check network mismatch for the new account
    void getKit().then(async (kit) => {
      try {
        const { networkPassphrase } = await kit.getNetwork();
        if (mountedRef.current) setWalletNetwork(networkPassphrase);
      } catch {
        if (mountedRef.current) setWalletNetwork(null);
      }
    });
  }, []);

  const reconnect = useCallback(async () => {
    const session = resolveReconnectSession(
      readStoredSessionRaw(),
      activeWalletIdRef.current,
      addressRef.current,
    );
    if (!session || syncingRef.current) return;
    syncingRef.current = true;
    setReconnecting(true);
    setReconnectError(null);
    try {
      const kit = await getKit();
      if (session.walletId) {
        kit.setWallet(session.walletId);
        activeWalletIdRef.current = session.walletId;
      }
      const { address: detected } = await kit.getAddress();
      if (!mountedRef.current) return;
      if (!detected) {
        setReconnectError(RECONNECT_DISCONNECTED_ERROR);
        return;
      }
      if (addressRef.current && shouldUpdateAddress(addressRef.current, detected)) {
        applyAccountChange(detected);
      } else if (!addressRef.current) {
        addressRef.current = detected;
        setAddress(detected);
        if (session.walletId) {
          writeStoredSessionRaw(serializeSession(session.walletId, detected));
        }
      }
      try {
        const { networkPassphrase } = await kit.getNetwork();
        if (mountedRef.current) setWalletNetwork(networkPassphrase);
      } catch {
        if (mountedRef.current) setWalletNetwork(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setReconnectError(
          err instanceof Error && err.message
            ? err.message
            : RECONNECT_DISCONNECTED_ERROR,
        );
      }
        // Wallet extension may be closed, locked, or busy; ignore background
        // errors but remember that the next signature may need the user to
        // unlock the wallet first.
        setLocked(true);
    } finally {
      syncingRef.current = false;
      if (mountedRef.current) {
        setReconnecting(false);
      }
    }
  }, [applyAccountChange]);

  // Restore only the public wallet choice; reconnecting remains user-initiated.
  useEffect(() => {
    const stored = readStoredSessionRaw();
    if (!stored) {
      setWalletSelectionLoaded(true);
      return;
    }
    const session = parseStoredSession(stored);
    if (!session) {
      removeStoredSessionRaw();
      setWalletSelectionLoaded(true);
      return;
    }
    const { walletId, address: saved } = session;
    setRememberedWalletId(walletId);
    setWalletSelectionLoaded(true);
    activeWalletIdRef.current = walletId;
    syncingRef.current = true;
    void getKit().then(async (kit) => {
      if (!mountedRef.current) return;
      kit.setWallet(walletId);
      let activeAddress = saved;
      try {
        const { address: detected } = await kit.getAddress();
        if (detected) {
          activeAddress = detected;
          if (detected !== saved) {
            writeStoredSessionRaw(serializeSession(walletId, detected));
          }
        }
      }
      if (!mountedRef.current) return;
      addressRef.current = activeAddress;
      setAddress(activeAddress);
      // Restore the network mismatch state for the restored session
      try {
        const { networkPassphrase } = await kit.getNetwork();
        if (mountedRef.current) setWalletNetwork(networkPassphrase);
      } catch {
        // Wallet may not support getNetwork; treat as no mismatch
        if (mountedRef.current) setWalletNetwork(null);
      }
    }).finally(() => {
      syncingRef.current = false;
    });
  }, []);

  // Re-establish the wallet session on window focus, pageshow (bfcache/background
  // resume), or document visibility change so backgrounded tabs recover cleanly
  // without a full reload.
  useEffect(() => {
    function onFocus() {
      void reconnect();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void reconnect();
      }
    }

    function onPageShow() {
      void reconnect();
    }

    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [reconnect]);

  const connect = useCallback(async () => {
    if (connectionAttemptRef.current || disconnectAttemptRef.current) return;
    connectionAttemptRef.current = true;
    setConnecting(true);
    setConnectingWallet(true);
    setError(null);
    setReconnectError(null);
    setLocked(false);
    try {
      const kit = await getKit();
      setNoWallet(await detectMissingWallet(kit));
      await kit.openModal({
        onWalletSelected: async (option) => {
          if (!connectionAttemptRef.current) return;
          try {
            kit.setWallet(option.id);
            activeWalletIdRef.current = option.id;
            setRememberedWalletId(option.id);
            setNoWallet(false);
            const { address: selected } = await kit.getAddress();
            addressRef.current = selected;
            setAddress(selected);
            setReconnectError(null);
            // Detect network mismatch after connection
            try {
              const { networkPassphrase } = await kit.getNetwork();
              setWalletNetwork(networkPassphrase);
            } catch {
              setWalletNetwork(null);
            }
            writeStoredSessionRaw(serializeSession(option.id, selected));
          } catch (err) {
            let message = err instanceof Error
              ? err.message
              : "Could not connect to the selected wallet.";
            if (previousWalletId) {
              try {
                kit.setWallet(previousWalletId);
              } catch (restoreError) {
                const detail = restoreError instanceof Error
                  ? restoreError.message
                  : String(restoreError);
                message = `${message} The previous wallet selection could not be restored: ${detail}`;
              }
            }
            setError(message);
          } finally {
            setConnecting(false);
            setConnectingWallet(false);
          }
        },
        onClosed: () => {
          setConnecting(false);
          setConnectingWallet(false);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open wallet");
      finish();
    }
  }, [activateWallet]);

  const reconnect = useCallback(async () => {
    const selectedWalletId = rememberedWalletId;
    if (
      !selectedWalletId ||
      connectionAttemptRef.current ||
      disconnectAttemptRef.current
    ) {
      return;
    }

    connectionAttemptRef.current = true;
    setConnecting(true);
    setReconnecting(true);
    setError(null);
    try {
      const kit = await getKit();
      await activateWallet(kit, selectedWalletId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not reconnect to the saved wallet.",
      );
    } finally {
      connectionAttemptRef.current = false;
      setConnecting(false);
      setConnectingWallet(false);
    }
  }, [activateWallet, rememberedWalletId]);

  const disconnect = useCallback(async () => {
    if (disconnectAttemptRef.current || connectionAttemptRef.current) return;
    disconnectAttemptRef.current = true;
    setDisconnecting(true);
    setError(null);
    try {
      const kit = await getKit();
      await kit.disconnect();
      const cleared = clearWalletSession();
      walletIdRef.current = null;
      setWalletId(null);
      setRememberedWalletId(null);
      addressRef.current = null;
      setAddress(null);
      setWalletNetwork(null);
      clearMerchantSession();
      if (!cleared) {
        setError("Wallet disconnected, but this browser could not clear the saved wallet selection.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not disconnect the wallet.",
      );
    } finally {
      disconnectAttemptRef.current = false;
      setDisconnecting(false);
    }
    removeStoredSessionRaw();
    // Drop the SEP-10 session now: the wallet is gone, so the token must not
    // outlive it. The provider is also unbound by the account effect below.
    clearMerchantSession();
    activeWalletIdRef.current = null;
    setRememberedWalletId(null);
    setNoWallet(false);
    addressRef.current = null;
    setAddress(null);
    setWalletNetwork(null);
    setReconnectError(null);
    setReconnecting(false);
    setSigning(false);
    setSignError(null);
    setLocked(false);
  }, []);

  const signXdr = useCallback<SignXdr>(
    async (xdrString, description): Promise<string> => {
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

      setSigning(true);
      setSignError(null);
      setLocked(false);
      try {
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
          // The wallet could not be read at all (closed, locked or busy), so
          // surface that the user may need to unlock it.
          setLocked(true);
          throw new Error(
            err instanceof Error ? err.message : "Could not read address from wallet.",
          );
        }

        if (shouldUpdateAddress(address, currentAddress)) {
          applyAccountChange(currentAddress!);
          throw new Error(ACCOUNT_CHANGED_ERROR);
        }

        // Explain what the transaction does before the wallet extension opens,
        // so the reader can back out without ever handing the XDR to the wallet.
        if (description) await requestSigningConfirmation(description);

        // translateSignatureError always throws: it replaces a cancellation
        // with a friendly message and rethrows anything else. A rejection is
        // not a locked wallet, so `locked` is left alone here.
        const { signedTxXdr } = await kit.signTransaction(xdrString, {
          networkPassphrase: config.networkPassphrase,
          address,
        });
        return signedTxXdr;
      } catch (err) {
        // Record the message callers will see, then translate the raw error so
        // a wallet that rejects with a plain object (Albedo) is still detected.
        setSignError(
          isSignatureRejection(err)
            ? SIGNATURE_CANCELLED_MESSAGE
            : err instanceof Error
              ? err.message
              : String(err),
        );
        translateSignatureError(err);
      } finally {
        // Every path, including a wallet rejection or an account switch, must
        // clear the pending state or the Subscribe buttons stay disabled.
        setSigning(false);
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
      walletId,
      rememberedWalletId,
      walletSelectionLoaded,
      connecting,
      reconnecting,
      rememberedWalletId,
      walletSelectionLoaded,
      noWallet,
      connectingWallet,
      error,
      reconnectError,
      networkMismatch,
      networkStatus,
      walletNetwork,
      account,
      funding,
      signing,
      signError,
      locked,
      connect,
      reconnect,
      disconnect,
      reconnect,
      refreshAccount,
      fund,
      signXdr,
    }),
    [
      address,
      walletId,
      rememberedWalletId,
      walletSelectionLoaded,
      connecting,
      reconnecting,
      rememberedWalletId,
      walletSelectionLoaded,
      noWallet,
      connectingWallet,
      error,
      reconnectError,
      networkMismatch,
      networkStatus,
      walletNetwork,
      account,
      funding,
      signing,
      signError,
      locked,
      connect,
      reconnect,
      disconnect,
      reconnect,
      refreshAccount,
      fund,
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
