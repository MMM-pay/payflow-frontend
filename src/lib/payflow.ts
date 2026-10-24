import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { config } from "./config";
import {
  checkProfileName,
  checkProfileUrl,
  type MerchantProfile,
} from "./profile";
import { mandateStatus } from "./mandate-status";
import { MIN_PERIOD_MESSAGE } from "./period";
import {
  SIGNATURE_CANCELLED_MESSAGE,
  isSignatureRejection,
  translateSignatureError,
} from "./signature-error";

export { SIGNATURE_CANCELLED_MESSAGE, isSignatureRejection, translateSignatureError };

/**
 * One RPC client per configured endpoint. The first entry is the primary; the
 * rest are fallbacks tried in order when a read fails with a network error.
 */
// `config.rpcUrls` is parsed to be non-empty, so the tuple type says so and
// callers need no undefined check on the primary.
export const servers: [rpc.Server, ...rpc.Server[]] = config.rpcUrls.map(
  (url) =>
    new rpc.Server(url, {
      allowHttp: url.startsWith("http://"),
    }),
) as [rpc.Server, ...rpc.Server[]];

/** The primary endpoint, kept for callers that only need one client. */
export const server = servers[0];

/**
 * True for errors that mean "this endpoint did not answer" — a transport
 * failure, a timeout, or a 5kx — as opposed to a contract or validation error
 * that the next endpoint would return identically. Only the former should
 * trigger a fallback.
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const err = error as { name?: string; message?: string; response?: { status?: number } };
  const status = err.response?.status;
  if (typeof status === "number" && status >= 400 && status < 500) return false;
  if (typeof status === "number" && status >= 500) return true;
  const name = err.name ?? "";
  if (name === "TimeoutError" || name === "AbortError") return true;
  if (name === "TypeError") return true; // fetch network failure
  const text = (err.message ?? "").toLowerCase();
  return (
    text.includes("fetch failed") ||
    text.includes("network") ||
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("etimedout") ||
    text.includes("timeout") ||
    text.includes("socket hang up") ||
    text.includes("502") ||
    text.includes("503") ||
    text.includes("504")
  );
}

/**
 * Runs `fn` against each endpoint in order, returning the first success.
 * Non-network errors are rethrown immediately so a contract error is never
 * retried against a second provider. Exported for tests.
 */
export async function withFallback<T>(
  fn: (srv: rpc.Server) => Promise<T>,
  clients: rpc.Server[] = servers,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < clients.length; i += 1) {
    try {
      return await fn(clients[i]!);
    } catch (err) {
      lastError = err;
      const isLast = i === clients.length - 1;
      if (isLast || !isNetworkError(err)) throw err;
    }
  }
  throw lastError;
}

/**
 * Semaphore to limit concurrent contract simulations.
 * Prevents hammering the RPC endpoint when many reads fire in parallel.
 */
class Semaphore {
  private permits: number;
  private waiters: Array< () => void > = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    this.permits += 1;
    const next = this.waiters.shift();
    if (next) {
      this.permits -= 1;
      next();
    }
  }
}

/**
 * Maximum concurrent contract simulations (reads).
 * Writes are never limited here — they are user-initiated and serialized by the wallet.
 */
export const MAX_CONCURRENT_READS = 6;

const readSemaphore = new Semaphore(MAX_CONCURRENT_READS);

/**
 * Error types that should trigger a retry.
 * Only applied to reads — writes are never retried.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes("fetch")) {
    // Network error (e.g., offline, DNS, CORS)
    return true;
  }
  if (error instanceof Response) {
    // HTTP error from fetch
    return error.status === 429 || error.status === 503;
  }
  // The stellar-sdk wraps RPC errors; check for rate limit / unavailable in message
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("429") ||
    message.includes("503") ||
    message.toLowerCase().includes("rate limit") ||
    message.toLowerCase().includes("service unavailable")
  );
}

/**
 * Exponential backoff with jitter.
 * attempt: 0-based attempt number (0 = first retry)
 */
function backoffDelay(attempt: number): number {
  const baseMs = 250; // 250ms, 500ms, 1000ms...
  const maxMs = 2000;
  const exponential = Math.min(baseMs * 2 ** attempt, maxMs);
  // Full jitter: random value in [0, exponential]
  return Math.random() * exponential;
}

/**
 * Read contract state via simulation with retry on rate limits and transient errors.
 *
 * `sourceAddress` only has to be an account that exists on the network — the
 * simulation never runs an operation against it.
 *
 * Retries up to 3 times (4 total attempts) on 429, 503, and network errors.
 * Never retries writes — callers must use `writeContract` for state changes.
 */
export async function readContract<T>(
  contractId: string,
  method: string,
  sourceAddress: string,
  args: xdr.ScVal[] = [],
): Promise<T> {
  let lastError: unknown;
  const maxAttempts = 4; // 1 initial + 3 retries

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await readSemaphore.acquire();
    try {
      const account = await server.getAccount(sourceAddress);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.networkPassphrase,
      })
        .addOperation(new Contract(contractId).call(method, ...args))
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);

      if (rpc.Api.isSimulationError(sim)) {
        throw new Error(decodeContractError(sim.error, method));
      }
      if (!("result" in sim) || !sim.result) {
        throw new Error(`${method}: simulation returned no result`);
      }
      return scValToNative(sim.result.retval) as T;
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt || !isRetryableError(err)) {
        throw err;
      }
    } finally {
      // Every acquire must be released, including the successful path: a
      // returned value used to keep its permit, so the seventh read waited
      // forever. Releasing here also frees the permit during the backoff
      // sleep below, which a failed read no longer holds.
      readSemaphore.release();
    }
    // Wait before retrying, then re-acquire for the next attempt.
    await new Promise((r) => setTimeout(r, backoffDelay(attempt)));
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/** Signs a transaction XDR and returns the signed XDR. Supplied by the wallet. */
export type SignXdr = (xdrString: string) => Promise<string>;

export const arg = {
  address: (v: string): xdr.ScVal => new Address(v).toScVal(),
  u64: (v: number | bigint): xdr.ScVal => nativeToScVal(v, { type: "u64" }),
  u32: (v: number): xdr.ScVal => nativeToScVal(v, { type: "u32" }),
  i128: (v: bigint): xdr.ScVal => nativeToScVal(v, { type: "i128" }),
  bool: (v: boolean): xdr.ScVal => nativeToScVal(v, { type: "bool" }),
  string: (v: string): xdr.ScVal => nativeToScVal(v, { type: "string" }),
};

/** Progress status of a transaction lifecycle (#17). */
export type TransactionStatus = "signing" | "submitted" | "confirmed" | "failed";

export type WriteContractProgressCallback = (status: TransactionStatus, txHash?: string) => void;

/**
 * Submit a state-changing call.
 *
 * `prepareTransaction` runs the simulation and attaches the resulting
 * authorization entries and resource footprint — skipping it produces
 * a transaction the network rejects.
 */
export async function writeContract(
  contractId: string,
  method: string,
  sourceAddress: string,
  signXdr: SignXdr,
  args: xdr.ScVal[] = [],
  onProgress?: WriteContractProgressCallback,
): Promise<string> {
  // Preparation is a read: it may be retried on another endpoint. The signed
  // transaction is then submitted exactly once — a write must never be sent
  // twice, so submission and polling are not wrapped in the fallback loop.
  const prepared = await withFallback(async (srv) => {
    const account = await srv.getAccount(sourceAddress);
    const built = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(60)
      .build();
    try {
      return await srv.prepareTransaction(built);
    } catch (err) {
      throw new Error(decodeContractError(err, method));
    }
  });

  onProgress?.("signing");
  let signedXdr: string;
  try {
    signedXdr = await signXdr(prepared.toXDR());
  } catch (err) {
    onProgress?.("failed");
    // A declined prompt must not look like a failed payment. Wallets that
    // throw their own text are rewritten; every other failure is unchanged.
    translateSignatureError(err);
  }
  const signed = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);

  const sent = await server.sendTransaction(signed);
  if (sent.status === "ERROR") {
    onProgress?.("failed");
    throw new Error(`${method} rejected: ${JSON.stringify(sent.errorResult)}`);
  }
  onProgress?.("submitted", sent.hash);

  const confirmed = await pollTransaction(sent.hash);
  if (confirmed.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    onProgress?.("failed", sent.hash);
    throw new Error(`${method} failed on-chain (${confirmed.status})`);
  }
  onProgress?.("confirmed", sent.hash);
  return sent.hash;
}

async function pollTransaction(
  hash: string,
  attempts = 15,
  delayMs = 1_000,
): Promise<rpc.Api.GetTransactionResponse> {
  let result = await withFallback((srv) => srv.getTransaction(hash));
  for (let i = 0; i < attempts; i += 1) {
    if (result.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return result;
    await new Promise((r) => setTimeout(r, delayMs));
    result = await withFallback((srv) => srv.getTransaction(hash));
  }
  return result;
}

/**
 * Maps the contracterror codes from payflow-contract onto readable text.
 *
 * Every entry mirrors a `#[contracterror]` variant in that repository's
 * `contracts/<name>/src/error.rs` (named in the comment). A code means different
 * things in different contracts, so never reuse a sentence across scopes
 * without checking the variant.
 */
const ERRORS: Record<string, Record<number, string>> = {
  plan_registry: {
    1: "The plan registry is already set up.", // AlreadyInitialized
    2: "The plan registry has not been set up yet.", // NotInitialized
    3: "That plan does not exist.", // PlanNotFound
    4: "You do not own that plan.", // NotPlanOwner
    5: "Amount must be greater than zero.", // InvalidAmount
    // Shared with the publish form's pre-flight check: a merchant who is told
    // "at least 60 seconds" by the form and sees the same words if they
    // somehow reach the simulation is not being given two different rules.
    6: MIN_PERIOD_MESSAGE, // InvalidPeriod
    7: "That plan name is too long.", // NameTooLong
    8: "That merchant has not set up a profile yet.", // ProfileNotFound
    9: "That profile name is too long.", // ProfileNameTooLong
    10: "That profile URL is too long.", // ProfileUrlTooLong
  },
  vault: {
    1: "The vault is already set up.", // AlreadyInitialized
    2: "The vault has not been set up yet.", // NotInitialized
    3: "Amount must be greater than zero.", // InvalidAmount
    4: "Not enough balance in your vault.", // InsufficientBalance
    5: "The vault is not wired to a subscription contract yet.", // SubscriptionNotSet
  },
  subscription: {
    1: "The subscription contract is already set up.", // AlreadyInitialized
    2: "The subscription contract has not been set up yet.", // NotInitialized
    3: "That subscription does not exist.", // MandateNotFound
    4: "You are not the subscriber on this mandate.", // NotSubscriber
    5: "This subscription is not active.", // MandateNotActive
    6: "This subscription is not due yet.", // NotDue
    7: "That plan is no longer accepting subscribers.", // PlanInactive
    8: "That protocol fee is above the 10% ceiling.", // FeeTooHigh
    9: "This subscription has reached its charge limit.", // MaxChargesReached
    10: "That charge limit is not valid.", // InvalidMaxCharges
    11: "Only the merchant on this subscription can end it.", // NotMerchant
  },
};

/**
 * Every error variant each contract can raise, keyed by contract and code.
 *
 * `ERRORS` above is the subset the UI has copy for; this table is the full
 * set from the docs repo's error reference. The test in
 * `test/contract-errors.test.ts` asserts that every entry here has a
 * non-generic message in `ERRORS` (or `CALLEE_ERRORS`), so a new contract
 * error cannot reach a user as "contract error #N".
 *
 * Codes are the `#[contracterror]` discriminants. Variants that carry no
 * user-facing meaning (e.g. an internal invariant) still need a sentence.
 */
export const CONTRACT_ERROR_CODES: Record<string, readonly number[]> = {
  plan_registry: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  vault: [1, 2, 3, 4, 5],
  subscription: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/**
 * Exported for tests: the message `decodeContractError` would produce for a
 * given contract scope and code, without going through the RPC error text.
 * Returns undefined when the code has no entry in `ERRORS`.
 */
export function contractErrorMessage(
  scope: keyof typeof CONTRACT_ERROR_CODES,
  code: number,
): string | undefined {
  return ERRORS[scope]?.[code];
}

/**
 * Codes raised by a contract that the called method invokes. An error in a
 * cross-contract call reaches the caller with the callee's number, so
 * `charge` failing in the vault reports the vault's #4 (not enough balance),
 * which the subscription table would misread as "not the subscriber". These
 * entries cover the codes a method can only get from its callee.
 */
export const CALLEE_ERRORS: Record<string, Record<number, string>> = {
  charge: {
    4: "The subscriber's vault does not hold enough to cover this charge.",
  },
  subscribe: {
    3: "That plan does not exist.",
  },
  set_max_charges: {
    8: "The new cap cannot be below the number of charges already made.",
  },
};

const REGISTRY_METHODS = new Set([
  "create_plan",
  "set_plan_active",
  "get_plan",
  "set_profile",
  "profile",
  "deactivate_page",
]);
const VAULT_METHODS = new Set(["deposit", "withdraw", "debit", "balance"]);

/**
 * Exported for tests: a wrong code-to-message mapping shows a user the wrong
 * reason their payment failed, which is a correctness bug rather than copy.
 */
export function decodeContractError(error: unknown, method: string): string {
  if (isSignatureRejection(error)) return SIGNATURE_CANCELLED_MESSAGE;
  const text =
    typeof error === "string" ? error : ((error as Error)?.message ?? String(error));
  const match = /Error\(Contract, #(\d+)\)/.exec(text);
  if (match?.[1]) {
    const code = Number(match[1]);
    const fromCallee = CALLEE_ERRORS[method]?.[code];
    if (fromCallee) return fromCallee;
    const scope = REGISTRY_METHODS.has(method)
      ? "plan_registry"
      : VAULT_METHODS.has(method)
        ? "vault"
        : "subscription";
    const known = ERRORS[scope]?.[code];
    if (known) return known;
    return `${method} failed with contract error #${code}.`;
  }
  if (/account not found/i.test(text)) {
    return "That account does not exist on testnet yet. Fund it with Friendbot first.";
  }
  // An empty or non-descriptive message must never reach the UI: pages render
  // errors with `{error && ...}`, so returning "" would fail the operation
  // silently and leave the user with no feedback at all.
  const trimmed = text.trim();
  if (!trimmed || trimmed === "[object Object]" || trimmed === "undefined") {
    return `${method} failed for an unknown reason. Check your wallet and try again.`;
  }
  return trimmed;
}

// ----------------------------------------------------------------------------
// Typed wrappers. These mirror payflow-contract's public interface exactly.
// ----------------------------------------------------------------------------

/**
 * Mirrors MAX_NAME_LEN in the plan-registry contract, which bounds the name in
 * BYTES. UTF-8 means a name can be under this many characters and still over
 * the limit, so callers must measure encoded length, not `String.length`.
 */
export const MAX_NAME_LEN = 64;

/** Encoded byte length of a plan name, as the contract counts it. */
export function nameByteLength(name: string): number {
  return new TextEncoder().encode(name).length;
}

/**
 * Validate a new plan name before anything is signed. Returns an error message,
 * or null when the name is acceptable. Empty names and names over
 * MAX_NAME_LEN bytes are rejected.
 */
export function validatePlanName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Enter a plan name.";
  if (nameByteLength(trimmed) > MAX_NAME_LEN) {
    return `Too long: ${MAX_NAME_LEN} bytes maximum.`;
  }
  return null;
}

export { nativeToScVal };

export interface Plan {
  id: bigint;
  merchant: string;
  name: string;
  token: string;
  amount: bigint;
  period: bigint;
  active: boolean;
  /**
   * Free trial in seconds, 0 meaning none — from payflow-contract#9, which has
   * not shipped. Optional because a contract built before that change decodes
   * to a map with no `trial` key, and reporting 0 there would claim a trial
   * does not exist rather than that we cannot tell.
   */
  trial?: bigint;
  /** Proposed payflow-contract#26; absent on older deployments. */
  available_until?: bigint;
  /** Proposed payflow-contract#25; 0 means unlimited. */
  max_subscribers?: number;
}

/** Mirrors MAX_PAGE in the contracts: the most ids an index call returns. */
export const MAX_PAGE = 50;

export interface Mandate {
  id: bigint;
  subscriber: string;
  plan_id: bigint;
  merchant: string;
  token: string;
  amount: bigint;
  period: bigint;
  next_charge: bigint;
  last_charge: bigint;
  charges_made: number;
  max_charges: number;
  fee_bps: number;
  /**
   * The discount the merchant set on this mandate, in basis points.
   *
   * Optional on purpose: payflow-contract#37 has not shipped, so a contract
   * built before it returns a `Mandate` map without these keys. Absent means
   * "this contract cannot say", which is not the same as "no discount" — see
   * `supportsDiscounts` in `lib/discount`.
   */
  discount_bps?: number;
  /** How many charges the discount covers. */
  discount_charges?: number;
  /** How many of those charges have been settled. */
  discount_charges_made?: number;
  /**
   * A `#[contracttype]` enum variant without data is encoded as a vector
   * holding its name, so this decodes as `["Active"]`, not `"Active"`. Use
   * `mandateStatus` to read it.
   */
  status: string | string[];
  /**
   * The trial frozen into the mandate at subscribe time, from
   * payflow-contract#9. Optional for the same reason as `Plan.trial`.
   */
  trial?: bigint;
  /**
   * When a paused mandate resumes, from payflow-contract#41. Optional because
   * the deployed contract predates it: a mandate decoded without the key means
   * that contract cannot service a pause-until, and the UI hides the control
   * rather than building a transaction the contract would reject.
   */
  pause_until?: bigint;
  /**
   * When a past-due mandate's grace period ends, from payflow-contract#34.
   * Optional because the deployed contract predates it.
   */
  past_due_until?: bigint;
  /**
   * The net amount the merchant received that can be refunded to the subscriber,
   * from payflow-contract#36. Optional because the deployed contract predates it.
   */
  refundable_amount?: bigint;
  /**
   * The address a subscriber has proposed to take over this mandate, from
   * payflow-contract#68. Optional because the deployed contract predates it:
   * a mandate decoded without the key means that contract cannot service a
   * transfer, and the UI hides the control rather than building a
   * transaction the contract would reject.
   */
  pending_subscriber?: string;


}

/**
 * The status name from a decoded `MandateStatus`. Comparing the raw value
 * with `=== "Active"` is always false, which on the contract-only path hid
 * "Charge now" and made Pause send a resume.
 */
export { mandateStatus };

/**
 * The address a transfer is pending to, or null when none is pending.
 *
 * Proposed in payflow-contract#68. A contract built before that change
 * decodes without `pending_subscriber`, so its absence *is* the capability
 * signal: there is no method to probe and no version to guess at, and
 * treating null as "no transfer" hides the accept panel exactly when the
 * contract cannot service it. Read through this helper rather than the raw
 * field because contract state carries a string while an indexer row may
 * carry null.
 */
export function mandatePendingSubscriber(mandate: unknown): string | null {
  const value = (mandate as { pending_subscriber?: unknown } | null | undefined)
    ?.pending_subscriber;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Whether the deployed contract supports moving a mandate to a new wallet.
 *
 * Proposed in payflow-contract#68. A contract built before that change has
 * neither the `transfer_mandate` / `accept_mandate_transfer` methods nor the
 * `pending_subscriber` field on `Mandate`. Since there is no version probe,
 * we check the field: if the decoded mandate carries the key at all (even
 * as null), the contract is new enough to service a transfer.
 */
export function mandateSupportsTransfer(mandate: unknown): boolean {
  if (!mandate || typeof mandate !== "object") return false;
  return Object.prototype.hasOwnProperty.call(mandate, "pending_subscriber");
}

/**
 * The wallet a mandate has been offered to, or null when there is no transfer
 * in flight. A contract that predates the field reads as "no transfer" rather
 * than as an error, so the control simply does not appear.
 */
export function mandatePendingTransfer(mandate: unknown): string | null {
  if (!mandateSupportsTransfer(mandate)) return null;
  const pending = (mandate as { pending_subscriber?: unknown }).pending_subscriber;
  return typeof pending === "string" && pending.length > 0 ? pending : null;
}

// ---------------------------------------------------------------------------
// Session cache for get_plan.
// ---------------------------------------------------------------------------

/**
 * The registry lets a plan change in exactly one way after `create_plan`: the
 * merchant flips `active` with `set_plan_active`. The name, price, period,
 * token and trial are frozen for the life of the plan, yet every page that
 * lists plans re-reads all of them — the subscribe page alone issues one
 * `get_plan` per plan on every visit.
 *
 * The cache lives here rather than in `chain.ts` because `get_plan` and the one
 * write that can invalidate a plan are both in this module: a write path cannot
 * forget to tell a cache it does not know about. It is per session (plain
 * module memory, so a reload starts clean) and only the mutable `active` flag
 * is trusted for `PLAN_ACTIVE_TTL_MS`. When that expires, the next `get_plan`
 * re-reads the whole record in one call and replaces the entry — the immutable
 * fields come along for free, so they never cost a read of their own.
 *
 * A future write that changes an immutable field (renaming a plan, #88) must
 * call `forgetPlan` afterwards, or the old name stays cached for the session.
 */
export const PLAN_ACTIVE_TTL_MS = 30_000;

interface CachedPlan {
  /** Everything but `active`: `create_plan` is the only writer of these. */
  immutable: Omit<Plan, "active">;
  active: boolean;
  /** When `active` was last read from the contract. */
  activeCheckedAt: number;
}

const planCache = new Map<string, CachedPlan>();

function planKey(planId: number | bigint): string {
  return String(planId);
}

/** Exported for tests. */
export function clearPlanCache(): void {
  planCache.clear();
}

/**
 * The cached plan when its `active` flag is still trusted, otherwise null so
 * the caller reads it again. `now` is a parameter so the TTL is testable
 * without fake timers.
 */
export function cachedPlan(
  planId: number | bigint,
  now: number = Date.now(),
): Plan | null {
  const entry = planCache.get(planKey(planId));
  if (!entry) return null;
  if (now - entry.activeCheckedAt >= PLAN_ACTIVE_TTL_MS) return null;
  return { ...entry.immutable, active: entry.active };
}

/** Cache a `get_plan` result, which is authoritative for every field. */
export function rememberPlan(plan: Plan, now: number = Date.now()): Plan {
  const { active, ...immutable } = plan;
  planCache.set(planKey(plan.id), { immutable, active, activeCheckedAt: now });
  return plan;
}

/**
 * Drop a plan from the cache. Called after our own successful write so the
 * next read comes from contract state: there is then no window in which a page
 * can serve the value the merchant just changed, and the refresh also picks up
 * any field a future contract version lets a write touch.
 */
export function forgetPlan(planId: number | bigint): void {
  planCache.delete(planKey(planId));
}

/**
 * When a mandate resumes, or null when the contract does not report it.
 *
 * A contract built before payflow-contract#41 decodes without `pause_until`,
 * so its absence *is* the capability signal: there is no method to probe and
 * no version to guess at, and treating null as "no such feature" hides the
 * date picker exactly when the contract cannot service it. Read through this
 * helper rather than the raw field because contract state carries a bigint
 * while an indexer row carries a number.
 */
export function mandatePauseUntil(mandate: unknown): number | null {
  const value = (mandate as { pause_until?: unknown } | null | undefined)?.pause_until;
  const seconds =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "number"
        ? value
        : Number.NaN;
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Whether a mandate is past due (vault could not cover a due charge).
 *
 * Proposed in payflow-contract#34. A contract built before that change decodes
 * without the `PastDue` status variant, so this returns false — the UI hides
 * the past-due badge and notice rather than guessing at support.
 */
export function mandateIsPastDue(mandate: unknown): boolean {
  return mandateStatus(mandate) === "PastDue";
}

/**
 * When the past-due grace period ends, or null when the contract does not
 * report it or the mandate is not past due.
 *
 * Proposed in payflow-contract#34 as `past_due_until`. Absent means the
 * contract cannot say, which the UI treats as "no grace period visible".
 */
export function mandatePastDueUntil(mandate: unknown): number | null {
  const value = (mandate as { past_due_until?: unknown } | null | undefined)?.past_due_until;
  const seconds =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "number"
        ? value
        : Number.NaN;
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Whether the deployed contract supports refunds on mandates.
 *
 * Proposed in payflow-contract#36. A contract built before that change does
 * not have the `refund` method, so calling it would fail. The UI hides the
 * refund button rather than building a transaction the contract would reject.
 *
 * Since there's no version probe, we check if the contract's `Mandate` type
 * carries a `refundable_amount` field (proposed as part of the refund feature).
 * If the field is absent, the contract cannot say, and the control stays hidden.
 */
export function mandateSupportsRefund(mandate: unknown): boolean {
  const value = (mandate as { refundable_amount?: unknown } | null | undefined)?.refundable_amount;
  return typeof value === "bigint" || typeof value === "number" || typeof value === "string";
}

/**
 * Whether the deployed contract supports spend limits on mandates.
 * A contract built before payflow-contract#28 does not have the
 * `set_spend_limit` / `get_spend_limit` methods, so this returns false — the
 * UI hides the control rather than building a transaction the contract would
 * reject.
 */
export function mandateSupportsSpendLimit(mandate: unknown): boolean {
  const value = (mandate as { spend_limit?: unknown } | null | undefined)?.spend_limit;
  return typeof value !== "undefined" && value !== null;
}

/**
 * Read the current spend limit for a mandate.
 * Returns `null` when the contract predates payflow-contract#28.
 */
export async function getSpendLimit(source: string, mandateId: number | bigint): Promise<number | null> {
  const result = await readContract<number | null>(config.contracts.subscription, "get_spend_limit", source, [
    arg.u64(mandateId),
  ]);
  return result;
}

/**
 * The maximum amount that can be refunded on this mandate, in the token's
 * smallest unit. Returns null when the contract cannot say.
 *
 * Proposed in payflow-contract#36 as `refundable_amount`. This represents the
 * net amount the merchant received (after fees) that can be refunded to the
 * subscriber.
 */
export function mandateRefundableAmount(mandate: unknown): bigint | null {
  const value = (mandate as { refundable_amount?: unknown } | null | undefined)?.refundable_amount;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  return null;
}

/**
 * One step of a sequential batch of contract writes.
 *
 * `id` is the mandate id the step acts on, so a caller can map a failure back
 * to the row the merchant selected without relying on array position.
 */
export interface BatchWriteStep<T> {
  id: bigint;
  run: () => Promise<T>;
}

export interface BatchWriteProgress<T> {
  /** The step that just finished, 1-based. */
  completed: number;
  /** How many steps the batch was asked to run. */
  total: number;
  /** The id of the step that just finished. */
  id: bigint;
  /** The value the step resolved to. */
  result: T;
}

export interface BatchWriteFailure<T> {
  /** The id of the step that failed. */
  id: bigint;
  /** The error the step threw, unchanged. */
  error: unknown;
  /** Results of the steps that succeeded before the failure, in order. */
  completed: Array<{ id: bigint; result: T }>;
  /** How many steps succeeded before the failure. */
  completedCount: number;
  /** How many steps were never attempted. */
  remainingCount: number;
}

export type BatchWriteOutcome<T> =
  | { ok: true; results: Array<{ id: bigint; result: T }> }
  | { ok: false; failure: BatchWriteFailure<T> };

/**
 * Run contract writes one at a time, stopping on the first failure.
 *
 * Writes are serialized rather than parallel because each one is signed by the
 * wallet and submitted as its own transaction: firing them together would
 * stack wallet prompts and race sequence numbers on the same source account.
 * The outcome reports exactly how far the batch got so the UI can say which
 * mandates were ended and which were not.
 *
 * Pure apart from the `run` callbacks, so it is testable without a wallet.
 */
export async function runSequentialWrites<T>(
  steps: ReadonlyArray<BatchWriteStep<T>>,
  onProgress?: (progress: BatchWriteProgress<T>) => void,
): Promise<BatchWriteOutcome<T>> {
  const results: Array<{ id: bigint; result: T }> = [];
  for (const [i, step] of steps.entries()) {
    try {
      const result = await step.run();
      results.push({ id: step.id, result });
      onProgress?.({ completed: i + 1, total: steps.length, id: step.id, result });
    } catch (error) {
      return {
        ok: false,
        failure: {
          id: step.id,
          error,
          completed: results,
          completedCount: results.length,
          remainingCount: steps.length - results.length - 1,
        },
      };
    }
  }
  return { ok: true, results };
}

/** A Stellar account a sponsor can pay into: a valid ed25519 public key. */
export function validateRecipient(recipient: string): string | null {
  const trimmed = recipient.trim();
  if (!trimmed) return "Enter a Stellar address.";
  return StrKey.isValidEd25519PublicKey(trimmed)
    ? null
    : "That is not a valid Stellar account address.";
}

/**
 * Whether the deployed vault contract exposes `deposit_for`.
 *
 * readContract simulates without committing, so a failed probe costs nothing
 * and no tokens move. A contract built before payflow-contract#29 has no such
 * method, so the simulation throws and the UI keeps the sponsor control
 * hidden rather than offering a write it cannot service.
 */
export async function vaultSupportsDepositFor(source: string): Promise<boolean> {
  if (!config.contracts.vault) return false;
  try {
    // Probe depositing the smallest possible amount into the caller's own
    // vault: if the method exists the contract answers, and nothing commits.
    await readContract(
      config.contracts.vault,
      "deposit_for",
      source,
      [arg.address(source), arg.address(config.contracts.token), arg.i128(1n)],
    );
    return true;
  } catch {
    return false;
  }
}

export const payflow = {
  // Proposed read interface for #25's open-mandate counter. Callers must
  // tolerate missing support until the contract ships this getter.
  planSubscriberCount: (source: string, planId: number | bigint) =>
    readContract<number>(config.contracts.subscription, "plan_subscriber_count", source, [arg.u64(planId)]),
  // --- plan registry ---
  getPlan: async (source: string, planId: number | bigint) => {
    const hit = cachedPlan(planId);
    if (hit) return hit;
    return rememberPlan(
      await readContract<Plan>(config.contracts.planRegistry, "get_plan", source, [
        arg.u64(planId),
      ]),
    );
  },

  createPlan: (
    source: string,
    sign: SignXdr,
    params: { token: string; amount: bigint; period: number; name: string; trial?: number },
  ) =>
    writeContract(
      config.contracts.planRegistry,
      "create_plan",
      source,
      sign,
      [
        arg.address(source),
        arg.address(params.token),
        arg.i128(params.amount),
        arg.u64(params.period),
        arg.string(params.name),
        // `trial` is appended only when the caller supplies one. The deployed
        // contract predates payflow-contract#9 and takes five arguments; adding
        // a sixth would make every publish fail. Callers pass it only after
        // `supportsTrials` confirms the contract answers with the field.
        ...(params.trial === undefined ? [] : [arg.u64(params.trial)]),
      ],
    ),

  /**
   * Whether the deployed plan registry has `set_plan_name`
   * (payflow-contract#16). Probed by simulating a rename to the plan's current
   * name: nothing commits, and a contract without the method rejects it, so
   * the UI hides the control instead of building a doomed transaction.
   */
  supportsPlanRename: async (source: string, plan: { id: number; name: string }): Promise<boolean> => {
    try {
      await readContract(config.contracts.planRegistry, "set_plan_name", source, [
        arg.address(source),
        arg.u64(plan.id),
        arg.string(plan.name),
      ]);
      return true;
    } catch {
      return false;
    }
  },

  setPlanName: async (
    source: string,
    sign: SignXdr,
    planId: number | bigint,
    name: string,
  ) => {
    const error = validatePlanName(name);
    if (error) throw new Error(error);
    const hash = await writeContract(
      config.contracts.planRegistry,
      "set_plan_name",
      source,
      sign,
      [arg.address(source), arg.u64(planId), arg.string(name.trim())],
    );
    forgetPlan(planId);
    return hash;
  },

  /**
   * The merchant's profile as the registry holds it, or null when the deployed
   * contract has no profiles at all. A merchant who has simply not set one
   * reads as an empty profile, which the UI treats differently: the first
   * hides the control, the second invites filling it in.
   */
  getProfile: async (source: string): Promise<MerchantProfile | null> => {
    try {
      const profile = await readContract<{ name?: unknown; url?: unknown }>(
        config.contracts.planRegistry,
        "profile",
        source,
        [arg.address(source)],
      );
      return {
        name: typeof profile?.name === "string" ? profile.name : "",
        url: typeof profile?.url === "string" ? profile.url : "",
      };
    } catch (err) {
      // ProfileNotFound means the merchant has none yet; anything else means
      // this contract cannot answer, so the control stays hidden.
      // #8 is ProfileNotFound: the contract has profiles, this merchant has
      // not set one. Any other failure means it cannot answer at all.
      if (/Error\(Contract, #8\)/.test(String((err as Error)?.message ?? err))) {
        return { name: "", url: "" };
      }
      return null;
    }
  },

  /** Set or clear the merchant's own profile. */
  setProfile: async (
    source: string,
    sign: SignXdr,
    profile: MerchantProfile,
  ) => {
    const name = checkProfileName(profile.name);
    if (!name.ok) throw new Error(name.message);
    const url = checkProfileUrl(profile.url);
    if (!url.ok) throw new Error(url.message);
    return writeContract(config.contracts.planRegistry, "set_profile", source, sign, [
      arg.address(source),
      arg.string(profile.name.trim()),
      arg.string(profile.url.trim()),
    ]);
  },

  setPlanActive: async (
    source: string,
    sign: SignXdr,
    planId: number | bigint,
    active: boolean,
  ) => {
    const hash = await writeContract(
      config.contracts.planRegistry,
      "set_plan_active",
      source,
      sign,
      [arg.address(source), arg.u64(planId), arg.bool(active)],
    );
    // `writeContract` polls until the transaction is confirmed, so the cached
    // record is now the only stale copy of this plan.
    forgetPlan(planId);
    return hash;
  },

  /**
   * Deactivate a page of the merchant's plans in one call.
   *
   * Mirrors `deactivate_page` in the plan registry contract: the merchant
   * specifies a page (start index and limit) and every plan in that page is
   * set to inactive. The cache entries for those plans are dropped so the next
   * read reflects the change.
   */
  deactivatePage: async (
    source: string,
    sign: SignXdr,
    start: number,
    limit: number,
  ) => {
    const hash = await writeContract(
      config.contracts.planRegistry,
      "deactivate_page",
      source,
      sign,
      [arg.address(source), arg.u32(start), arg.u32(limit)],
    );
    // The write confirmed; we cannot know exactly which plan IDs were in the
    // page without re-reading, so the conservative approach is to clear the
    // entire plan cache. The next read will repopulate it from contract state.
    clearPlanCache();
    return hash;
  },

  // --- vault ---
  /** Whether the vault has enough balance to cover the first plan charge (#33). */
  hasSufficientVaultBalance: (vaultBalance: bigint | null, planPrice: bigint): boolean => {
    if (vaultBalance === null) return true;
    return vaultBalance >= planPrice;
  },

  vaultBalance: (source: string, user: string, token: string) =>
    readContract<bigint>(config.contracts.vault, "balance", source, [
      arg.address(user),
      arg.address(token),
    ]),

  deposit: (source: string, sign: SignXdr, token: string, amount: bigint) =>
    writeContract(config.contracts.vault, "deposit", source, sign, [
      arg.address(source),
      arg.address(token),
      arg.i128(amount),
    ]),

  withdraw: (source: string, sign: SignXdr, token: string, amount: bigint) =>
    writeContract(config.contracts.vault, "withdraw", source, sign, [
      arg.address(source),
      arg.address(token),
      arg.i128(amount),
    ]),

  /**
   * Sponsor another account's vault: the caller's tokens are credited to the
   * recipient's vault balance, and only the recipient can withdraw.
   *
   * Built against the interface proposed in payflow-contract#29:
   * `deposit_for(recipient: Address, token: Address, amount: i128)`. The
   * caller is the transaction's source account and is not passed as an
   * argument — it authorizes the payment by signing the transaction.
   *
   * Only call this when `vaultSupportsDepositFor` confirms the deployed
   * contract carries the method.
   */
  depositFor: (source: string, sign: SignXdr, recipient: string, token: string, amount: bigint) =>
    writeContract(config.contracts.vault, "deposit_for", source, sign, [
      arg.address(recipient),
      arg.address(token),
      arg.i128(amount),
    ]),

  // --- subscription ---
  getMandate: (source: string, id: number | bigint) =>
    readContract<Mandate>(config.contracts.subscription, "get_mandate", source, [
      arg.u64(id),
    ]),

  /**
   * The protocol's current fee, in basis points. Read live rather than hardcoded
   * so a merchant previewing a fee split sees the rate their subscribers will
   * actually be charged: the contract freezes `fee_bps` into each mandate at
   * subscribe time, but an admin can change it between mandates.
   */
  feeBps: (source: string) =>
    readContract<number>(config.contracts.subscription, "fee_bps", source),

  // Index getters are paged: at most MAX_PAGE ids per call, oldest first.
  merchantPlanCount: (source: string, merchant: string) =>
    readContract<number>(config.contracts.planRegistry, "merchant_plan_count", source, [
      arg.address(merchant),
    ]),

  merchantPlans: (source: string, merchant: string, start: number, limit: number) =>
    readContract<bigint[]>(config.contracts.planRegistry, "merchant_plans", source, [
      arg.address(merchant),
      arg.u32(start),
      arg.u32(limit),
    ]),

  /** Plans are numbered from 1, so this minus one is how many exist. */
  nextPlanId: (source: string) =>
    readContract<bigint>(config.contracts.planRegistry, "next_plan_id", source),

  subscriberMandateCount: (source: string, subscriber: string) =>
    readContract<number>(
      config.contracts.subscription,
      "subscriber_mandate_count",
      source,
      [arg.address(subscriber)],
    ),

  subscriberMandates: (source: string, subscriber: string, start: number, limit: number) =>
    readContract<bigint[]>(
      config.contracts.subscription,
      "subscriber_mandates",
      source,
      [arg.address(subscriber), arg.u32(start), arg.u32(limit)],
    ),

  merchantMandateCount: (source: string, merchant: string) =>
    readContract<number>(
      config.contracts.subscription,
      "merchant_mandate_count",
      source,
      [arg.address(merchant)],
    ),

  merchantMandates: (source: string, merchant: string, start: number, limit: number) =>
    readContract<bigint[]>(
      config.contracts.subscription,
      "merchant_mandates",
      source,
      [arg.address(merchant), arg.u32(start), arg.u32(limit)],
    ),

  isDue: (source: string, mandateId: number | bigint) =>
    readContract<boolean>(config.contracts.subscription, "is_due", source, [
      arg.u64(mandateId),
    ]),

  subscribe: (
    source: string,
    sign: SignXdr,
    planId: number | bigint,
    maxCharges: number,
  ) =>
    writeContract(config.contracts.subscription, "subscribe", source, sign, [
      arg.address(source),
      arg.u64(planId),
    ]),

  charge: (source: string, sign: SignXdr, id: number | bigint) =>
    writeContract(config.contracts.subscription, "charge", source, sign, [
      arg.u64(id),
    ]),

  pause: (source: string, sign: SignXdr, id: number | bigint) =>
    writeContract(config.contracts.subscription, "pause", source, sign, [
      arg.address(source),
      arg.u64(id),
    ]),

  resume: (source: string, sign: SignXdr, id: number | bigint) =>
    writeContract(config.contracts.subscription, "resume", source, sign, [
      arg.address(source),
      arg.u64(id),
    ]),

  cancel: (source: string, sign: SignXdr, id: number | bigint) =>
    writeContract(config.contracts.subscription, "cancel", source, sign, [
      arg.address(source),
      arg.u64(id),
    ]),

  endMandate: (source: string, sign: SignXdr, id: number | bigint) =>
    writeContract(config.contracts.subscription, "end_mandate", source, sign, [
      arg.address(source),
      arg.u64(id),
    ]),

  // --- indexes ---
  listPlans: (source: string, start: number | bigint) =>
    readContract<bigint[]>(config.contracts.planRegistry, "list_plans", source, [
      arg.u64(start),
    ]),

  listMandatesBySubscriber: (source: string, user: string, start: number | bigint) =>
    readContract<bigint[]>(
      config.contracts.subscription,
      "list_mandates_by_subscriber",
      source,
      [arg.address(user), arg.u64(start)],
    ),

  listMandatesByMerchant: (source: string, user: string, start: number | bigint) =>
    readContract<bigint[]>(
      config.contracts.subscription,
      "list_mandates_by_merchant",
      source,
      [arg.address(user), arg.u64(start)],
    ),

  setPaused: (
    source: string,
    sign: SignXdr,
    mandateId: number | bigint,
    paused: boolean,
  ) =>
    writeContract(config.contracts.subscription, "set_paused", source, sign, [
      arg.u64(mandateId),
      arg.bool(paused),
    ]),

  /**
   * Subscriber side: change a mandate's charge cap. The contract rejects a cap
   * below `charges_made`, so callers should validate against the mandate's
   * current `charges_made` before submitting.
   */
  setMaxCharges: (
    source: string,
    sign: SignXdr,
    mandateId: number | bigint,
    maxCharges: number | bigint,
  ) =>
    writeContract(config.contracts.subscription, "set_max_charges", source, sign, [
      arg.address(source),
      arg.u64(mandateId),
      arg.u32(Number(maxCharges)),
    ]),

  /**
   * Subscriber side: pause billing until a point in time, from the interface
   * proposed in payflow-contract#41. Only callable against a contract that
   * carries `pause_until` — see `mandatePauseUntil`, which is how the UI
   * decides whether to offer this at all.
   */
  pauseUntil: (
    source: string,
    sign: SignXdr,
    mandateId: number | bigint,
    untilUnixSeconds: number,
  ) =>
    writeContract(config.contracts.subscription, "pause_until", source, sign, [
      arg.address(source),
      arg.u64(mandateId),
      arg.u64(untilUnixSeconds),
    ]),

  /**
   * Merchant side: attach a discount to one of the merchant's mandates.
   *
   * Built against the interface proposed in payflow-contract#37: the
   * discount is a rate in basis points and covers a number of charges. The
   * contract charges the discounted amount for those charges and the full
   * price afterwards; a discount can only lower the price.
   */
  setDiscount: (
    source: string,
    sign: SignXdr,
    mandateId: number | bigint,
    discountBps: number,
    discountCharges: number,
  ) =>
    writeContract(config.contracts.subscription, "set_discount", source, sign, [
      arg.u64(mandateId),
      arg.u32(discountBps),
      arg.u32(discountCharges),
    ]),

  /**
   * Merchant side: issue a refund on one of the merchant's mandates.
   *
   * Built against the interface proposed in payflow-contract#36: the refund
   * is linked to a mandate and specifies the amount to return to the
   * subscriber. The amount is capped at what the merchant received (net of
   * fees) for that mandate.
   */
  refund: (
    source: string,
    sign: SignXdr,
    mandateId: number | bigint,
    amount: bigint,
  ) =>
    writeContract(config.contracts.subscription, "refund", source, sign, [
      arg.address(source),
      arg.u64(mandateId),
      arg.i128(amount),
    ]),

  /**
   * Subscriber side: propose moving this mandate to a new wallet.
   *
   * Built against the interface proposed in payflow-contract#68:
   * `transfer_mandate(subscriber: Address, mandate_id: u64, new_subscriber:
   * Address)`. The current subscriber authorizes the proposal by signing;
   * the mandate keeps billing the old wallet until the new one accepts.
   *
   * Only call this when `mandateSupportsTransfer` confirms the deployed
   * contract carries the field.
   */
  transferMandate: (
    source: string,
    sign: SignXdr,
    mandateId: number | bigint,
    newSubscriber: string,
  ) =>
    writeContract(config.contracts.subscription, "transfer_mandate", source, sign, [
      arg.address(source),
      arg.u64(mandateId),
      arg.address(newSubscriber),
    ]),

  /**
   * New wallet side: accept a pending transfer of a mandate to the caller.
   *
   * Built against the interface proposed in payflow-contract#68:
   * `accept_mandate_transfer(new_subscriber: Address, mandate_id: u64)`. The
   * receiving wallet authorizes by signing; the contract only accepts when
   * `pending_subscriber` on the mandate matches the caller.
   */
  acceptMandateTransfer: (
    source: string,
    sign: SignXdr,
    mandateId: number | bigint,
  ) =>
    writeContract(config.contracts.subscription, "accept_mandate_transfer", source, sign, [
      arg.address(source),
      arg.u64(mandateId),
    ]),

  /** Check if an account has established a trustline on Horizon */
  checkTrustline: (
    address: string,
    assetCode: string,
    assetIssuer?: string,
    horizonUrl: string = config.horizonUrl,
  ) => checkTrustline(address, assetCode, assetIssuer, horizonUrl),

  /** Establish a trustline for a classic Stellar asset via ChangeTrust */
  addTrustline: (
    source: string,
    sign: SignXdr,
    assetCode: string,
    assetIssuer: string,
  ) => addTrustline(source, sign, assetCode, assetIssuer),
};

/**
 * Checks whether an account has an established trustline for a classic asset on Horizon.
 * Returns true if the account holds or has a trustline for the specified asset.
 */
export async function checkTrustline(
  address: string,
  assetCode: string,
  assetIssuer?: string,
  horizonUrl: string = config.horizonUrl,
): Promise<boolean> {
  if (!address || !assetCode || !horizonUrl) return true;
  try {
    const res = await fetch(`${horizonUrl}/accounts/${address}`, { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      balances?: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>;
    };
    if (!data.balances) return false;
    return data.balances.some(
      (b) =>
        b.asset_code === assetCode &&
        (!assetIssuer || b.asset_issuer === assetIssuer),
    );
  } catch {
    return false;
  }
}

/**
 * Builds and submits a ChangeTrust operation to establish a trustline for a classic asset.
 */
export async function addTrustline(
  source: string,
  sign: SignXdr,
  assetCode: string,
  assetIssuer: string,
): Promise<string> {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(assetCode, assetIssuer),
      }),
    )
    .setTimeout(30)
    .build();

  let signedXdr: string;
  try {
    signedXdr = await sign(tx.toXDR());
  } catch (err) {
    translateSignatureError(err);
    throw err;
  }

  const signed = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);
  const sent = await server.sendTransaction(signed);
  if (sent.status === "ERROR") {
    throw new Error(`changeTrust rejected: ${JSON.stringify(sent.errorResult)}`);
  }
  const confirmed = await pollTransaction(sent.hash);
  if (confirmed.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`changeTrust failed on-chain (${confirmed.status})`);
  }
  return sent.hash;
}

/** What `validateMaxCharges` needs to judge a proposed cap. */
export interface MaxChargesCheck {
  /** The cap the subscriber typed, already parsed. */
  maxCharges: bigint;
  /** Charges the mandate has already settled; the cap can never go below it. */
  chargesMade: bigint;
  /** The cap currently in force, for context in the message. */
  currentMaxCharges: bigint;
  /** Upper bound the contract enforces, when the deployment has one. */
  maxAllowed?: bigint;
}

/**
 * Whether the deployed subscription contract carries `set_max_charges`. The
 * control is hidden rather than offered and rejected on a contract that
 * predates it.
 */
export function canSetMaxCharges(methods: readonly string[] | null | undefined): boolean {
  return !!methods && methods.includes("set_max_charges");
}

/**
 * Why a proposed charge cap cannot be submitted, or null when it can.
 *
 * The contract rejects a cap below `charges_made`, so the same rule is checked
 * here: a wallet should never open for a transaction the chain will refuse.
 */
export function validateMaxCharges({
  maxCharges,
  chargesMade,
  maxAllowed,
}: MaxChargesCheck): string | null {
  if (maxCharges < 1n) return "The cap must be at least 1 charge.";
  if (maxCharges < chargesMade) {
    return `The cap cannot be below the ${chargesMade} charges made already.`;
  }
  if (maxAllowed !== undefined && maxCharges > maxAllowed) {
    return `The cap can be at most ${maxAllowed}.`;
  }
  return null;
}

/**
 * Whether a mandate's cap can still be edited at all: a mandate that has
 * reached its cap is completed, and a completed mandate has nothing to cap.
 */
export function canEditChargeCap(
  chargesMade: number,
  maxCharges: number | null,
): boolean {
  if (chargesMade < 0) return false;
  if (maxCharges === null || maxCharges === 0) return true;
  return chargesMade < maxCharges;
}

/**
 * Parse a decimal amount into stroops, or null when it is not an amount this
 * can submit. Integer arithmetic throughout: a cap above ~90 million XLM
 * would lose its last digits through Number.
 */
export function parseChargeCapInput(input: string): bigint | null {
  const text = input.trim();
  if (!text || !/^\d+(\.\d{1,7})?$/.test(text)) return null;
  const parts = text.split(".");
  const padded = ((parts[1] ?? "") + "0000000").slice(0, 7);
  const whole = parts[0] ?? "0";
  const stroops = BigInt(whole) * 10_000_000n + BigInt(padded);
  return stroops > 0n ? stroops : null;
}
