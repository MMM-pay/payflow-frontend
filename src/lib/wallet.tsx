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

/** Returns false when the browser refused to store it (e.g. private browsing). */
function writeStoredSessionRaw(value: string): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

/** Returns false when the browser refused to remove it. */
function removeStoredSessionRaw(): boolean {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

const SAVE_PREFERENCE_FAILED_ERROR =
  "Wallet connected, but this browser could not remember your wallet choice.";
const CLEAR_PREFERENCE_FAILED_ERROR =
  "Wallet disconnected, but this browser could not clear the saved wallet selection.";
const NETWORK_UNVERIFIED_ERROR =
  "Could not read your wallet's network. Signing is disabled until it can be checked.";
const NETWORK_MISMATCH_ERROR = "Switch your wallet to the correct network first.";

export function checkNetworkMismatch(
  walletNetwork: string | null,
  targetPassphrase = config.networkPassphrase,
): boolean {
  if (!walletNetwork) return false;
  return walletNetwork !== targetPassphrase;
}

export type WalletNetworkStatus = "unknown" | "matching" | "mismatch";

/** Whether the wallet's network is known and, if so, whether it is the app's. */
export function getWalletNetworkStatus(
  walletNetwork: string | null,
  targetPassphrase = config.networkPassphrase,
): WalletNetworkStatus {
  if (!walletNetwork) return "unknown";
  return checkNetworkMismatch(walletNetwork, targetPassphrase) ? "mismatch" : "matching";
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
  /** The wallet the connected session runs through, or null when disconnected. */
  walletId: string | null;
  connecting: boolean;
  /** True while re-establishing a wallet session after the tab returns to focus. */
  reconnecting?: boolean;
  /** The wallet chosen last time, offered for a deliberate reconnect. */
  rememberedWalletId: string | null;
  /** False until the saved wallet choice has been read from storage. */
  walletSelectionLoaded: boolean;
  noWallet: boolean;
  /** True while a wallet modal is open or a signature request is in flight. */
  connectingWallet: boolean;
  error: string | null;
  /** Error surfaced if re-establishing the session on resume failed. */
  reconnectError?: string | null;
  networkMismatch: boolean;
  /** Whether the connected wallet's network is unknown, the app's, or another. */
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
  disconnect: () => Promise<void>;
  /** Reconnects the remembered wallet. Only ever called by a user action. */
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
  // Set while a connect/reconnect or a disconnect is running, so a second
  // click cannot open another modal or race the first attempt.
  const connectionAttemptRef = useRef(false);
  const disconnectAttemptRef = useRef(false);
  // Bumped on every disconnect: an async wallet read that started before it
  // compares its captured value and drops its result instead of reviving the
  // session the user just ended.
  const sessionGenerationRef = useRef(0);
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

  const networkStatus: WalletNetworkStatus = address
    ? getWalletNetworkStatus(walletNetwork)
    : "unknown";
  const networkMismatch = networkStatus === "mismatch";

  const readWalletNetwork = useCallback(async (kit: StellarWalletsKit, generation: number) => {
    try {
      const { networkPassphrase } = await kit.getNetwork();
      if (mountedRef.current && sessionGenerationRef.current === generation) {
        setWalletNetwork(networkPassphrase);
      }
    } catch {
      if (mountedRef.current && sessionGenerationRef.current === generation) {
        setWalletNetwork(null);
      }
    }
  }, []);

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
    const generation = sessionGenerationRef.current;
    void getKit().then((kit) => readWalletNetwork(kit, generation));
  }, [readWalletNetwork]);

  /**
   * Select `id` in the kit and read its account and network. Throws when the
   * wallet is unavailable or the user rejects the request, leaving the
   * remembered choice alone so it can be retried.
   */
  const activateWallet = useCallback(async (kit: StellarWalletsKit, id: string) => {
    const generation = sessionGenerationRef.current;
    kit.setWallet(id);
    const { address: selected } = await kit.getAddress();
    if (!mountedRef.current || sessionGenerationRef.current !== generation) return;
    if (!selected) throw new Error(RECONNECT_DISCONNECTED_ERROR);
    activeWalletIdRef.current = id;
    setWalletId(id);
    setRememberedWalletId(id);
    setNoWallet(false);
    if (addressRef.current && addressRef.current !== selected) clearMerchantSession();
    addressRef.current = selected;
    setAddress(selected);
    setReconnectError(null);
    await readWalletNetwork(kit, generation);
    if (!writeStoredSessionRaw(serializeSession(id, selected)) && mountedRef.current) {
      setError(SAVE_PREFERENCE_FAILED_ERROR);
    }
  }, [readWalletNetwork]);

  /**
   * Re-read an already connected session when the tab comes back, so an
   * account or network switch made in the extension meanwhile is picked up.
   * Never connects a wallet the user has not connected in this page.
   */
  const syncSession = useCallback(async () => {
    const current = addressRef.current;
    const id = activeWalletIdRef.current;
    if (!current || !id || syncingRef.current || connectionAttemptRef.current) return;
    const generation = sessionGenerationRef.current;
    syncingRef.current = true;
    setReconnecting(true);
    setReconnectError(null);
    try {
      const kit = await getKit();
      kit.setWallet(id);
      const { address: detected } = await kit.getAddress();
      if (!mountedRef.current || sessionGenerationRef.current !== generation) return;
      if (!detected) {
        setReconnectError(RECONNECT_DISCONNECTED_ERROR);
        return;
      }
      if (shouldUpdateAddress(addressRef.current, detected)) {
        applyAccountChange(detected);
      }
      await readWalletNetwork(kit, generation);
    } catch (err) {
      if (mountedRef.current && sessionGenerationRef.current === generation) {
        setReconnectError(
          err instanceof Error && err.message ? err.message : RECONNECT_DISCONNECTED_ERROR,
        );
        // The extension may be closed, locked or busy: the next signature may
        // need the user to unlock it first.
        setLocked(true);
      }
    } finally {
      syncingRef.current = false;
      if (mountedRef.current) setReconnecting(false);
    }
  }, [applyAccountChange, readWalletNetwork]);

  // Restore only the remembered wallet choice. Reconnecting asks the wallet
  // for the account, so it stays a deliberate user action.
  useEffect(() => {
    const stored = readStoredSessionRaw();
    const session = parseStoredSession(stored);
    if (session) setRememberedWalletId(session.walletId);
    // A value that is not a session (corrupt or from an older build) is
    // dropped so it is not re-read on every load.
    else if (stored !== null) removeStoredSessionRaw();
    setWalletSelectionLoaded(true);
  }, []);

  // Re-check the session on window focus, pageshow (bfcache/background resume)
  // or when the document becomes visible, so a backgrounded tab recovers
  // without a full reload.
  useEffect(() => {
    function onFocus() {
      void syncSession();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void syncSession();
      }
    }

    function onPageShow() {
      void syncSession();
    }

    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [syncSession]);

  const reconnect = useCallback(async () => {
    const id = rememberedWalletId ?? activeWalletIdRef.current;
    if (!id || connectionAttemptRef.current || disconnectAttemptRef.current) return;
    connectionAttemptRef.current = true;
    setConnecting(true);
    setReconnecting(true);
    setError(null);
    setReconnectError(null);
    setLocked(false);
    try {
      const kit = await getKit();
      await activateWallet(kit, id);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Could not reconnect to the saved wallet.");
      }
    } finally {
      connectionAttemptRef.current = false;
      if (mountedRef.current) {
        setConnecting(false);
        setReconnecting(false);
      }
    }
  }, [activateWallet, rememberedWalletId]);

  const connect = useCallback(async () => {
    if (connectionAttemptRef.current || disconnectAttemptRef.current) return;
    connectionAttemptRef.current = true;
    setConnecting(true);
    setConnectingWallet(true);
    setError(null);
    setReconnectError(null);
    setLocked(false);
    const finish = () => {
      connectionAttemptRef.current = false;
      if (mountedRef.current) {
        setConnecting(false);
        setConnectingWallet(false);
      }
    };
    try {
      const kit = await getKit();
      setNoWallet(await detectMissingWallet(kit));
      await kit.openModal({
        onWalletSelected: async (option) => {
          if (!connectionAttemptRef.current) return;
          const previousWalletId = activeWalletIdRef.current;
          try {
            await activateWallet(kit, option.id);
          } catch (err) {
            let message = err instanceof Error
              ? err.message
              : "Could not connect to the selected wallet.";
            // Put the kit back on the wallet the live session still uses.
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
            if (mountedRef.current) setError(message);
          } finally {
            finish();
          }
        },
        onClosed: finish,
      });
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Could not open wallet");
      finish();
    }
  }, [activateWallet]);

  const disconnect = useCallback(async () => {
    if (disconnectAttemptRef.current) return;
    disconnectAttemptRef.current = true;
    setError(null);
    try {
      const kit = await getKit();
      await kit.disconnect();
    } catch (err) {
      // The wallet still holds the session, so keep ours and say why.
      disconnectAttemptRef.current = false;
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Could not disconnect the wallet.");
      }
      return;
    }
    sessionGenerationRef.current += 1;
    const cleared = removeStoredSessionRaw();
    // Drop the SEP-10 session now: the wallet is gone, so the token must not
    // outlive it. The provider is also unbound by the account effect below.
    clearMerchantSession();
    activeWalletIdRef.current = null;
    connectionAttemptRef.current = false;
    disconnectAttemptRef.current = false;
    if (!mountedRef.current) return;
    setWalletId(null);
    setRememberedWalletId(null);
    setNoWallet(false);
    addressRef.current = null;
    setAddress(null);
    setWalletNetwork(null);
    setReconnectError(null);
    setReconnecting(false);
    setConnecting(false);
    setConnectingWallet(false);
    setSigning(false);
    setSignError(null);
    setLocked(false);
    if (!cleared) setError(CLEAR_PREFERENCE_FAILED_ERROR);
  }, []);

  const signXdr = useCallback<SignXdr>(
    async (xdrString, description): Promise<string> => {
      if (!address) throw new Error("Connect a wallet first.");
      const kit = await getKit();

      // Wallet extensions can change networks without changing accounts, so
      // the network is read from the wallet itself, never from what was seen
      // at connect time. A network that cannot be read blocks signing.
      const assertNetwork = async () => {
        let activeNetwork: string;
        try {
          ({ networkPassphrase: activeNetwork } = await kit.getNetwork());
        } catch {
          setWalletNetwork(null);
          throw new Error(NETWORK_UNVERIFIED_ERROR);
        }
        setWalletNetwork(activeNetwork);
        if (checkNetworkMismatch(activeNetwork)) throw new Error(NETWORK_MISMATCH_ERROR);
      };
      await assertNetwork();

      setSigning(true);
      setSignError(null);
      setLocked(false);
      try {
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

        // The confirmation can stay open for a while; check again right
        // before the wallet signs.
        await assertNetwork();

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
    [address, applyAccountChange, requestSigningConfirmation],
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
      disconnect,
      reconnect,
      refreshAccount,
      fund,
      signXdr,
    }),
    [
      address,
      walletId,
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
