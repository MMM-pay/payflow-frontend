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

export const server = new rpc.Server(config.rpcUrl, {
  allowHttp: config.rpcUrl.startsWith("http://"),
});

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
  let result = await server.getTransaction(hash);
  for (let i = 0; i < attempts; i += 1) {
    if (result.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return result;
    await new Promise((r) => setTimeout(r, delayMs));
    result = await server.getTransaction(hash);
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

// ---------------------------------------------------------------------------
// Typed wrappers. These mirror payflow-contract's public interface exactly.
// ---------------------------------------------------------------------------

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
}

/** Mirrors MAX_PAGE in the contracts: the most ids one index call returns. */
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
    params: { token: string; amount: bigint; period: number; name: string },
  ) =>
    writeContract(config.contracts.planRegistry, "create_plan", source, sign, [
      arg.address(source),
      arg.address(params.token),
      arg.i128(params.amount),
      arg.u64(params.period),
      arg.string(params.name),
    ]),

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
  getMandate: (source: string, mandateId: number | bigint) =>
    readContract<Mandate>(config.contracts.subscription, "get_mandate", source, [
      arg.u64(mandateId),
    ]),

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
      arg.address(source),
      arg.u64(mandateId),
      arg.bool(paused),
    ]),

  /** Permissionless: anyone may settle a due mandate. */
  charge: (source: string, sign: SignXdr, mandateId: number | bigint) =>
    writeContract(config.contracts.subscription, "charge", source, sign, [
      arg.u64(mandateId),
    ]),
};
