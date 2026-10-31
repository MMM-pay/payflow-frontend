import {
  Asset,
  BASE_FEE,
  Contract,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  arg,
  createClient,
  planRegistryMethods,
  subscriptionMethods,
  vaultMethods,
  type ContractScope,
  type Plan,
  type SignXdr,
} from "./bindings";
import { config } from "./config";
import { MAX_NAME_LEN, decodeContractError, nameByteLength } from "./payflow-core";

import {
  checkProfileName,
  checkProfileUrl,
  type MerchantProfile,
} from "./profile";
import {
  SIGNATURE_CANCELLED_MESSAGE,
  isSignatureRejection,
  translateSignatureError,
} from "./signature-error";

export { SIGNATURE_CANCELLED_MESSAGE, isSignatureRejection, translateSignatureError };
export { arg };

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







// ---------------------------------------------------------------------------
// Contract limits shared by the UI. The method bindings live in ./bindings.
// ---------------------------------------------------------------------------

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
 * Read the current spend limit for a mandate.
 * Returns `null` when the contract predates payflow-contract#28.
 */
export async function getSpendLimit(
  source: string,
  mandateId: number | bigint,
): Promise<number | null> {
  return contractClient.getSpendLimit(source, mandateId);
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

const contractClient = createClient(
  { ...planRegistryMethods, ...vaultMethods, ...subscriptionMethods },
  { read: readContract, write: writeContract },
  (scope: ContractScope) =>
    scope === "plan_registry" ? config.contracts.planRegistry : config.contracts[scope],
);

/**
 * The plan cache above explains why every page benefits from remembering the
 * record. Reads go through the generated binding; only the cache policy stays
 * here.
 */
async function getPlan(source: string, planId: number | bigint): Promise<Plan> {
  const hit = cachedPlan(planId);
  if (hit) return hit;
  return rememberPlan(await contractClient.getPlan(source, planId));
}

/** Write that invalidates one cached plan after the transaction confirms. */
async function setPlanActive(
  source: string,
  sign: SignXdr,
  planId: number | bigint,
  active: boolean,
): Promise<string> {
  const hash = await contractClient.setPlanActive(source, sign, planId, active);
  // `writeContract` polls until the transaction is confirmed, so the cached
  // record is now the only stale copy of this plan.
  forgetPlan(planId);
  return hash;
}

/**
 * Deactivate a page of the merchant's plans in one call, then clear the whole
 * cache: the page's exact plan ids are unknown without re-reading, and the
 * next read repopulates from contract state.
 */
async function deactivatePage(
  source: string,
  sign: SignXdr,
  start: number,
  limit: number,
): Promise<string> {
  const hash = await contractClient.deactivatePage(source, sign, start, limit);
  clearPlanCache();
  return hash;
}

/**
 * Every contract method from the generated bindings, plus the two session
 * behaviours that cannot live in a pure binding: the `get_plan` cache and
 * Horizon trustline helpers.
 */
export const payflow = {
  ...contractClient,
  getPlan,
  setPlanActive,
  deactivatePage,

  /**
   * Whether the deployed plan registry has `set_plan_name`
   * (payflow-contract#16). Probed by simulating a rename to the plan's current
   * name: nothing commits, and a contract without the method rejects it, so
   * the UI hides the control instead of building a doomed transaction.
   */
  supportsPlanRename: async (
    source: string,
    plan: { id: number; name: string },
  ): Promise<boolean> => {
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

  /** Rename a plan, then drop the cached record so the next read is fresh. */
  setPlanName: async (
    source: string,
    sign: SignXdr,
    planId: number | bigint,
    name: string,
  ): Promise<string> => {
    const error = validatePlanName(name);
    if (error) throw new Error(error);
    const hash = await contractClient.setPlanName(source, sign, planId, name.trim());
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
      const profile = await contractClient.getProfile(source);
      return {
        name: typeof profile?.name === "string" ? profile.name : "",
        url: typeof profile?.url === "string" ? profile.url : "",
      };
    } catch (err) {
      // #8 is ProfileNotFound: the contract has profiles, this merchant has
      // not set one. Any other failure means it cannot answer at all, so the
      // control stays hidden.
      if (/Error\(Contract, #8\)/.test(String((err as Error)?.message ?? err))) {
        return { name: "", url: "" };
      }
      return null;
    }
  },

  /** Set or clear the merchant's own profile. */
  setProfile: async (source: string, sign: SignXdr, profile: MerchantProfile) => {
    const name = checkProfileName(profile.name);
    if (!name.ok) throw new Error(name.message);
    const url = checkProfileUrl(profile.url);
    if (!url.ok) throw new Error(url.message);
    return contractClient.setProfile(source, sign, profile.name.trim(), profile.url.trim());
  },

  /** Whether the vault has enough balance to cover the first plan charge (#33). */
  hasSufficientVaultBalance: (vaultBalance: bigint | null, planPrice: bigint): boolean => {
    if (vaultBalance === null) return true;
    return vaultBalance >= planPrice;
  },

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

/**
 * Re-exported from `payflow-core`, which has no SDK dependency, so a page
 * can import these without the SDK joining its bundle.
 */
export {
  CALLEE_ERRORS,
  mandatePendingTransfer,
  mandateSupportsTransfer,
  CONTRACT_ERROR_CODES,
  MAX_NAME_LEN,
  MAX_PAGE,
  canEditChargeCap,
  canSetMaxCharges,
  contractErrorMessage,
  decodeContractError,
  mandateIsPastDue,
  mandatePastDueUntil,
  mandatePauseUntil,
  mandateRefundableAmount,
  mandateStatus,
  mandateSupportsRefund,
  mandateSupportsSpendLimit,
  nameByteLength,
  parseChargeCapInput,
  validateMaxCharges,
  validateRecipient,
} from "./payflow-core";
export type { MaxChargesCheck } from "./payflow-core";
export type { Mandate, Plan, SignXdr } from "./payflow-core";
