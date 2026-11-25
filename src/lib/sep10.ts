/**
 * SEP-10 web authentication for merchant-only API calls.
 *
 * Merchant-only requests (managing webhooks today; further merchant-private
 * reads as the backend grows) need to prove the connected wallet owns the
 * merchant account. Signing every request is wasteful, so the backend
 * (payflow-backend#141) is adding SEP-10 sessions: a one-time challenge the
 * wallet signs in exchange for a bearer token that authorizes a run of
 * requests until it expires.
 *
 * payflow-backend#141 has not shipped at implementation time. Everything here
 * is built against the proposed interface below and degrades to "no token"
 * (the request is sent unauthenticated, as it is today) when the deployed
 * backend does not serve the SEP-10 endpoints. The first 404 from
 * `GET /api/auth` is remembered for the page session so a merchant page does
 * not re-probe the absent endpoint on every call; a reload re-tries.
 *
 * Proposed wire format (confirm with the backend implementation before
 * enabling in production):
 *
 *   GET  /api/auth?account=<G...>
 *        200 { transaction: "<challenge XDR>", network_passphrase: "<...>" }
 *        404 when SEP-10 is not served
 *
 *   POST /api/auth   { transaction: "<signed challenge XDR>" }
 *        200 { token: "<bearer>", expires_at: <unix seconds> }
 *        401 when the signature does not verify
 *
 * The challenge is a Stellar transaction, so it is signed with the wallet's
 * transaction signer (`signXdr`), not message signing. The returned token is
 * kept in memory only — never localStorage — so it cannot outlive the wallet
 * session or be reused by another tab or user. See `docs/sep10-sessions.md`.
 */

/** A challenge transaction the wallet must sign, as `GET /api/auth` returns. */
export interface AuthChallenge {
  /** Unsigned transaction XDR the wallet signs with `signXdr`. */
  transaction: string;
  /** Passphrase the challenge transaction is built for. */
  networkPassphrase: string;
}

/** A bearer token that authorizes merchant-only requests until `expiresAt`. */
export interface MerchantToken {
  /** The bearer string sent as `Authorization: Bearer <token>`. */
  token: string;
  /** Unix seconds after which the server will reject the token. */
  expiresAt: number;
  /** The account the token was minted for; the store keys on this. */
  address: string;
}

/**
 * Re-sign this many seconds before the token's stated expiry so a request is
 * never sent with a token the server is about to reject. Clock skew between
 * the browser and the backend is absorbed by the margin rather than by a
 * failed request.
 */
export const TOKEN_REFRESH_MARGIN_SEC = 60;

/** True when `token` is missing, malformed, or close enough to expiry to renew. */
export function isTokenExpired(
  token: MerchantToken | undefined | null,
  now: number,
  marginSec: number = TOKEN_REFRESH_MARGIN_SEC,
): boolean {
  if (!token) return true;
  if (!token.token) return true;
  if (!Number.isSafeInteger(token.expiresAt) || token.expiresAt <= 0) return true;
  return now + marginSec >= token.expiresAt;
}

/** Parses and validates the body of `GET /api/auth`. `null` means "not a challenge". */
export function parseChallenge(body: unknown): AuthChallenge | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const transaction = record.transaction;
  const networkPassphrase = record.network_passphrase;
  if (typeof transaction !== "string" || transaction.trim().length === 0) return null;
  if (typeof networkPassphrase !== "string" || networkPassphrase.trim().length === 0) return null;
  return { transaction, networkPassphrase };
}

/** Parses and validates the body of `POST /api/auth`. `null` means "not a token". */
export function parseToken(body: unknown, address: string, now: number): MerchantToken | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const token = record.token;
  const expiresAt = record.expires_at;
  if (typeof token !== "string" || token.trim().length === 0) return null;
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
  if (typeof address !== "string" || address.trim().length === 0) return null;
  return { token, expiresAt, address };
}

/**
 * In-memory store of merchant session tokens, keyed by address. Never
 * persisted: a bearer token in localStorage would outlive the wallet session
 * and let another tab or user reuse it. Exported as a class so tests can hold
 * an isolated store without touching the module singleton.
 */
export class MerchantSessionStore {
  private readonly tokens = new Map<string, MerchantToken>();

  get(address: string): MerchantToken | undefined {
    return this.tokens.get(address);
  }

  set(token: MerchantToken): void {
    this.tokens.set(token.address, token);
  }

  clear(address: string): void {
    this.tokens.delete(address);
  }

  clearAll(): void {
    this.tokens.clear();
  }

  has(address: string): boolean {
    return this.tokens.has(address);
  }

  get size(): number {
    return this.tokens.size;
  }
}

/**
 * A challenge-fetch outcome. `unsupported` is distinguished from `error` so the
 * orchestrator can remember "the backend does not serve SEP-10" without
 * giving up after a transient network blip.
 */
export type ChallengeResult =
  | { status: "ok"; challenge: AuthChallenge }
  | { status: "unsupported" }
  | { status: "error" };

/** A token-submit outcome, distinguished for the same reason as `ChallengeResult`. */
export type SubmitResult =
  | { status: "ok"; token: MerchantToken }
  | { status: "unsupported" }
  | { status: "error" };

/** Dependencies injected so the SEP-10 flow is testable without a browser. */
export interface MerchantSessionDeps {
  /** The merchant account the token is minted for. */
  address: string;
  /** Signs the challenge transaction XDR; the wallet context's `signXdr`. */
  signXdr: (xdr: string, description?: string) => Promise<string>;
  /** Backend base URL; `config.apiUrl` in production. */
  apiUrl: string;
  /** Passphrase the challenge must be built for; `config.networkPassphrase`. */
  networkPassphrase: string;
  /** Fetch implementation; defaults to the global. */
  fetch?: typeof fetch;
  /** Clock; defaults to Unix seconds. */
  now?: () => number;
}

/** Fetch and validate the challenge transaction for `account`. */
export async function fetchChallenge(
  deps: MerchantSessionDeps,
  signal?: AbortSignal,
): Promise<ChallengeResult> {
  const doFetch = deps.fetch ?? fetch;
  try {
    const res = await doFetch(
      `${deps.apiUrl}/api/auth?account=${encodeURIComponent(deps.address)}`,
      { cache: "no-store", signal },
    );
    // 404 (and 405) mean the backend does not serve SEP-10 at all: remember
    // that so the page does not re-probe on every merchant-only call.
    if (res.status === 404 || res.status === 405) return { status: "unsupported" };
    if (!res.ok) return { status: "error" };
    const challenge = parseChallenge(await res.json());
    return challenge ? { status: "ok", challenge } : { status: "error" };
  } catch {
    // A network failure or abort is transient: do not cache it as unsupported.
    return { status: "error" };
  }
}

/** Submit the signed challenge and validate the returned token. */
export async function submitChallenge(
  deps: MerchantSessionDeps,
  signedXdr: string,
  signal?: AbortSignal,
): Promise<SubmitResult> {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  try {
    const res = await doFetch(`${deps.apiUrl}/api/auth`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: signedXdr }),
      signal,
    });
    if (res.status === 404 || res.status === 405) return { status: "unsupported" };
    // 401/403 means the signature did not verify; treat as a transient failure
    // so a retry (after the user reconnects the right account) can succeed.
    if (!res.ok) return { status: "error" };
    const token = parseToken(await res.json(), deps.address, now);
    return token ? { status: "ok", token } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/**
 * In-memory session state: the token store and the set of addresses the
 * backend has told us it cannot serve SEP-10 for this page session. Grouped
 * so a test can hold an isolated copy without touching the module singleton.
 */
export interface MerchantSession {
  store: MerchantSessionStore;
  unsupported: Set<string>;
}

/** A fresh, isolated session for tests or a custom provider. */
export function createMerchantSession(): MerchantSession {
  return { store: new MerchantSessionStore(), unsupported: new Set() };
}

/**
 * Returns a valid bearer token for `deps.address`, running the SEP-10
 * challenge when the cached token is missing or about to expire.
 *
 * Resolves to `null` (so the caller sends the request unauthenticated) when:
 *  - the backend does not serve SEP-10 (`unsupported`, cached for the page
 *    session so it is not re-probed on every call), or
 *  - a transient network or signature failure occurs (not cached, so a retry
 *    can succeed once the wallet or network recovers).
 *
 * Signing failures are deliberately not cached: a user who cancels the prompt
 * or switches accounts mid-challenge should be able to retry.
 */
export async function getMerchantToken(
  deps: MerchantSessionDeps,
  session: MerchantSession,
  signal?: AbortSignal,
): Promise<string | null> {
  const { address } = deps;
  if (!address || !deps.apiUrl) return null;

  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  const cached = session.store.get(address);
  if (cached && !isTokenExpired(cached, now)) return cached.token;

  // A prior 404 told us this backend has no SEP-10 endpoint; do not re-probe.
  if (session.unsupported.has(address)) return null;

  const challengeRes = await fetchChallenge(deps, signal);
  if (challengeRes.status === "unsupported") {
    session.unsupported.add(address);
    return null;
  }
  if (challengeRes.status === "error") return null;

  const challenge = challengeRes.challenge;
  // A challenge for the wrong network would sign a transaction the server
  // cannot verify; refuse rather than prompting the user to sign it.
  if (challenge.networkPassphrase !== deps.networkPassphrase) {
    session.unsupported.add(address);
    return null;
  }

  let signedXdr: string;
  try {
    signedXdr = await deps.signXdr(
      challenge.transaction,
      "authenticate this merchant session with your wallet",
    );
  } catch {
    // User cancelled, account changed, or the wallet is on the wrong network.
    // Do not cache: a retry may succeed once the wallet is in the right state.
    return null;
  }

  const submitRes = await submitChallenge(deps, signedXdr, signal);
  if (submitRes.status === "ok") {
    session.store.set(submitRes.token);
    return submitRes.token.token;
  }
  if (submitRes.status === "unsupported") {
    session.unsupported.add(address);
    return null;
  }
  return null;
}

/**
 * The page's session. A module singleton because the api client is a module
 * singleton and the wallet context outlives any one component. Cleared on
 * disconnect and account change by the wallet context (see `wallet.tsx`).
 */
export const merchantSession: MerchantSession = createMerchantSession();

/**
 * Token-provider bridge. The wallet context sets this to a closure bound to
 * the connected account; the api client calls `merchantAuthToken` to obtain
 * the bearer for a merchant-only request. Keeping the bridge here (rather
 * than importing the wallet into the api client) keeps the dependency
 * one-way: both `wallet.tsx` and `api.ts` depend on this module, not on each
 * other.
 */
let tokenProvider: ((address: string) => Promise<string | null>) | null = null;

export function setMerchantTokenProvider(
  fn: ((address: string) => Promise<string | null>) | null,
): void {
  tokenProvider = fn;
}

/**
 * The bearer token for `address`, or `null` when no wallet is bound or the
 * backend does not serve SEP-10. The api client spreads the result into
 * `Authorization` headers; a `null` return means "send the request as it
 * would have been sent before SEP-10".
 */
export async function merchantAuthToken(address: string): Promise<string | null> {
  if (!address || !tokenProvider) return null;
  try {
    return await tokenProvider(address);
  } catch {
    // A provider must never throw into a request path; degrade to unauthenticated.
    return null;
  }
}

/**
 * Forget the session for one account (an account switch) or every account
 * (a disconnect). Called by the wallet context so a token for the old account
 * can never be attached to a request made after the change.
 */
export function clearMerchantSession(address?: string): void {
  if (address) {
    merchantSession.store.clear(address);
    merchantSession.unsupported.delete(address);
  } else {
    merchantSession.store.clearAll();
    merchantSession.unsupported.clear();
  }
}

/** Test-only: reset all module state between tests. */
export function resetMerchantSession(): void {
  tokenProvider = null;
  clearMerchantSession();
}
