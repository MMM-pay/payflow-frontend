import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { config } from "./config";

/**
 * One RPC client per configured endpoint. The first entry is the primary; the
 * rest are fallbacks tried in order when a read fails with a network error.
 */
export const servers: rpc.Server[] = config.rpcUrls.map(
  (url) =>
    new rpc.Server(url, {
      allowHttp: url.startsWith("http://"),
    }),
);

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
      return await fn(clients[i]);
    } catch (err) {
      lastError = err;
      const isLast = i === clients.length - 1;
      if (isLast || !isNetworkError(err)) throw err;
    }
  }
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

/**
 * Read contract state via simulation. Costs nothing and submits nothing.
 *
 * `sourceAddress` only has to be an account that exists on the network — the
 * simulation never runs an operation against it.
 */
export async function readContract<T>(
  contractId: string,
  method: string,
  sourceAddress: string,
  args: xdr.ScVal[] = [],
): Promise<T> {
  const sim = await withFallback(async (srv) => {
    const account = await srv.getAccount(sourceAddress);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();

    const result = await srv.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(result)) {
      throw new Error(decodeContractError(result.error, method));
    }
    return result;
  });

  if (!("result" in sim) || !sim.result) {
    throw new Error(`${method}: simulation returned no result`);
  }
  return scValToNative(sim.result.retval) as T;
}

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

  const signedXdr = await signXdr(prepared.toXDR());
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
  let result = await withFallback((srv) => srv.getTransaction(hash));
  for (let i = 0; i < attempts; i += 1) {
    if (result.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return result;
    await new Promise((r) => setTimeout(r, delayMs));
    result = await withFallback((srv) => srv.getTransaction(hash));
  }
  return result;
}

/** Maps the contracterror codes from payflow-contract onto readable text. */
const ERRORS: Record<string, Record<number, string>> = {
  plan_registry: {
    3: "That plan does not exist.",
    4: "You do not own that plan.",
    5: "Amount must be greater than zero.",
    6: "Billing period must be at least 60 seconds.",
    7: "That plan name is too long.",
  },
  vault: {
    3: "Amount must be greater than zero.",
    4: "Not enough balance in your vault.",
    5: "The vault is not wired to a subscription contract yet.",
  },
  subscription: {
    3: "That subscription does not exist.",
    4: "You are not the subscriber on this mandate.",
    5: "This subscription is not active.",
    6: "This subscription is not due yet.",
    7: "That plan is no longer accepting subscribers.",
    9: "This subscription has reached its charge limit.",
    11: "Only the merchant on this subscription can end it.",
  },
};

/**
 * Codes raised by a contract that the called method invokes. An error in a
 * cross-contract call reaches the caller with the callee's number, so
 * `charge` failing in the vault reports the vault's #4 (not enough balance),
 * which the subscription table would misread as "not the subscriber". These
 * entries cover the codes a method can only get from its callee.
 */
const CALLEE_ERRORS: Record<string, Record<number, string>> = {
  charge: {
    4: "The subscriber's vault does not hold enough to cover this charge.",
  },
  subscribe: {
    3: "That plan does not exist.",
  },
};

const REGISTRY_METHODS = new Set(["create_plan", "set_plan_active", "get_plan"]);
const VAULT_METHODS = new Set(["deposit", "withdraw", "debit", "balance"]);

/**
 * Exported for tests: a wrong code-to-message mapping shows a user the wrong
 * reason their payment failed, which is a correctness bug rather than copy.
 */
export function decodeContractError(error: unknown, method: string): string {
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
}

/**
 * The status name from a decoded `MandateStatus`. Comparing the raw value
 * with `=== "Active"` is always false, which on the contract-only path hid
 * "Charge now" and made Pause send a resume.
 */
export function mandateStatus(raw: unknown): string {
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw ?? "");
}

export const payflow = {
  // --- plan registry ---
  getPlan: (source: string, planId: number | bigint) =>
    readContract<Plan>(config.contracts.planRegistry, "get_plan", source, [
      arg.u64(planId),
    ]),

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

  setPlanActive: (
    source: string,
    sign: SignXdr,
    planId: number | bigint,
    active: boolean,
  ) =>
    writeContract(config.contracts.planRegistry, "set_plan_active", source, sign, [
      arg.address(source),
      arg.u64(planId),
      arg.bool(active),
    ]),

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
};