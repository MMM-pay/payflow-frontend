import {
  Address,
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
import { config } from "./config";
import type { Mandate, Plan, SignXdr } from "./payflow-core";
import { decodeContractError } from "./payflow-core";
import {
  SIGNATURE_CANCELLED_MESSAGE,
  isSignatureRejection,
  translateSignatureError,
} from "./signature-error";

export { SIGNATURE_CANCELLED_MESSAGE, isSignatureRejection, translateSignatureError };

/**
 * The pure contract constants, types and helpers live in `payflow-core`, which
 * has no SDK dependency, so pages can import them without pulling ~570 kB of
 * SDK into their first-load bundle. They are re-exported here so existing
 * callers and tests keep one import site.
 */
export {
  CALLEE_ERRORS,
  CONTRACT_ERROR_CODES,
  MAX_NAME_LEN,
  MAX_PAGE,
  contractErrorMessage,
  decodeContractError,
  mandateIsPastDue,
  mandatePauseUntil,
  mandatePastDueUntil,
  mandateRefundableAmount,
  mandateStatus,
  mandateSupportsRefund,
  mandateSupportsSpendLimit,
  nameByteLength,
  validateRecipient,
} from "./payflow-core";
export type { Mandate, Plan, SignXdr };

export const server = new rpc.Server(config.rpcUrl, {
  allowHttp: config.rpcUrl.startsWith("http://"),
});

/**
 * Semaphore to limit concurrent contract simulations.
 * Prevents hammering the RPC endpoint when many reads fire in parallel.
 */
class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];

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


export const arg = {
  address: (v: string): xdr.ScVal => new Address(v).toScVal(),
  u64: (v: number | bigint): xdr.ScVal => nativeToScVal(v, { type: "u64" }),
  u32: (v: number): xdr.ScVal => nativeToScVal(v, { type: "u32" }),
  i128: (v: bigint): xdr.ScVal => nativeToScVal(v, { type: "i128" }),
  bool: (v: boolean): xdr.ScVal => nativeToScVal(v, { type: "bool" }),
  string: (v: string): xdr.ScVal => nativeToScVal(v, { type: "string" }),
};

/**
 * Submit a state-changing call.
 *
 * `prepareTransaction` runs the simulation and attaches the resulting
 * authorization entries and resource footprint — skipping it produces a
 * transaction the network rejects.
 */
export async function writeContract(
  contractId: string,
  method: string,
  sourceAddress: string,
  signXdr: SignXdr,
  args: xdr.ScVal[] = [],
): Promise<string> {
  const account = await server.getAccount(sourceAddress);
  const built = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();

  let prepared;
  try {
    prepared = await server.prepareTransaction(built);
  } catch (err) {
    throw new Error(decodeContractError(err, method));
  }

  let signedXdr: string;
  try {
    signedXdr = await signXdr(prepared.toXDR());
  } catch (err) {
    // A declined prompt must not look like a failed payment. Wallets that
    // throw their own text are rewritten; every other failure is unchanged.
    translateSignatureError(err);
  }
  const signed = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);

  const sent = await server.sendTransaction(signed);
  if (sent.status === "ERROR") {
    throw new Error(`${method} rejected: ${JSON.stringify(sent.errorResult)}`);
  }

  const confirmed = await pollTransaction(sent.hash);
  if (confirmed.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`${method} failed on-chain (${confirmed.status})`);
  }
  return sent.hash;
}

async function pollTransaction(
  hash: string,
  attempts = 15,
  delayMs = 1_000,
): Promise<rpc.Api.GetTransactionResponse> {
  let result = await server.getTransaction(hash);
  for (let i = 0; i < attempts; i += 1) {
    if (result.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return result;
    await new Promise((r) => setTimeout(r, delayMs));
    result = await server.getTransaction(hash);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Typed wrappers. These mirror payflow-contract's public interface exactly.
// ---------------------------------------------------------------------------

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
  getMandate: (source: string, mandateId: number | bigint) =>
    readContract<Mandate>(config.contracts.subscription, "get_mandate", source, [
      arg.u64(mandateId),
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
      arg.u32(maxCharges),
    ]),

  cancel: (source: string, sign: SignXdr, mandateId: number | bigint) =>
    writeContract(config.contracts.subscription, "cancel", source, sign, [
      arg.address(source),
      arg.u64(mandateId),
    ]),

  /** Merchant side: permanently stop billing one of the merchant's mandates. */
  endMandate: (source: string, sign: SignXdr, mandateId: number | bigint) =>
    writeContract(config.contracts.subscription, "end_mandate", source, sign, [
      arg.address(source),
      arg.u64(mandateId),
    ]),

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

  /** Permissionless: anyone may settle a due mandate. */
  charge: (source: string, sign: SignXdr, mandateId: number | bigint) =>
    writeContract(config.contracts.subscription, "charge", source, sign, [
      arg.u64(mandateId),
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
