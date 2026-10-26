import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { Mandate, Plan, SignXdr } from "./payflow-core";

/**
 * Typed bindings for the deployed Payflow contracts.
 *
 * The shape follows `stellar contract bindings typescript`: every method names
 * the contract it belongs to and encodes its arguments with `arg`, so a wrong
 * ScVal type is caught here instead of by the network at submission time.
 * `payflow.ts` supplies the RPC read/write implementation and the per-session
 * behaviour (such as the plan cache); this module only describes the contract
 * interface.
 */

/**
 * The record types the contracts return. Re-exported from `payflow-core` so
 * the bindings and the rest of the contract layer share one definition.
 */
export type { Mandate, Plan, SignXdr };

/** Encoders for the ScVal types the contracts take. */
export const arg = {
  address: (v: string): xdr.ScVal => new Address(v).toScVal(),
  u64: (v: number | bigint): xdr.ScVal => nativeToScVal(v, { type: "u64" }),
  u32: (v: number): xdr.ScVal => nativeToScVal(v, { type: "u32" }),
  i128: (v: bigint): xdr.ScVal => nativeToScVal(v, { type: "i128" }),
  bool: (v: boolean): xdr.ScVal => nativeToScVal(v, { type: "bool" }),
  string: (v: string): xdr.ScVal => nativeToScVal(v, { type: "string" }),
};

export type ContractScope = "plan_registry" | "vault" | "subscription";

export interface CreatePlanParams {
  token: string;
  amount: bigint;
  period: number;
  name: string;
  trial?: number;
}

interface ReadMethod<A extends readonly unknown[], T> {
  readonly kind: "read";
  readonly method: string;
  readonly scope: ContractScope;
  readonly encode: (...args: A) => xdr.ScVal[];
  /** Phantom field that carries the decoded result type. */
  readonly result?: T;
}

interface WriteMethod<A extends readonly unknown[]> {
  readonly kind: "write";
  readonly method: string;
  readonly scope: ContractScope;
  readonly encode: (source: string, ...args: A) => xdr.ScVal[];
}

export function readMethod<A extends readonly unknown[], T>(
  method: string,
  scope: ContractScope,
  encode: (...args: A) => xdr.ScVal[],
): ReadMethod<A, T> {
  return { kind: "read", method, scope, encode };
}

export function writeMethod<A extends readonly unknown[]>(
  method: string,
  scope: ContractScope,
  encode: (source: string, ...args: A) => xdr.ScVal[],
): WriteMethod<A> {
  return { kind: "write", method, scope, encode };
}

type AnyMethod = ReadMethod<never[], unknown> | WriteMethod<never[]>;

type CallOf<M> = M extends ReadMethod<infer A, infer T>
  ? (source: string, ...args: A) => Promise<T>
  : M extends WriteMethod<infer A>
    ? (source: string, sign: SignXdr, ...args: A) => Promise<string>
    : never;

export type Client<M> = {
  [K in keyof M]: CallOf<M[K]>;
};

/** The RPC implementation the bindings call through. */
export interface ContractRuntime {
  read<T>(
    contractId: string,
    method: string,
    source: string,
    args: xdr.ScVal[],
  ): Promise<T>;
  write(
    contractId: string,
    method: string,
    source: string,
    sign: SignXdr,
    args: xdr.ScVal[],
  ): Promise<string>;
}

/**
 * Turn a method table into callable functions.
 *
 * Reads are called as `(source, ...args)` and writes as
 * `(source, sign, ...args)`, matching the wrappers the pages already import.
 */
export function createClient<M extends Record<string, AnyMethod>>(
  methods: M,
  runtime: ContractRuntime,
  contractId: (scope: ContractScope) => string,
): Client<M> {
  const client: Record<string, unknown> = {};

  for (const [name, method] of Object.entries(methods) as [string, AnyMethod][]) {
    if (method.kind === "read") {
      const encode = method.encode as (...args: unknown[]) => xdr.ScVal[];
      client[name] = (source: string, ...args: unknown[]) =>
        runtime.read(contractId(method.scope), method.method, source, encode(...args));
    } else {
      const encode = method.encode as (
        source: string,
        ...args: unknown[]
      ) => xdr.ScVal[];
      client[name] = (source: string, sign: SignXdr, ...args: unknown[]) =>
        runtime.write(
          contractId(method.scope),
          method.method,
          source,
          sign,
          encode(source, ...args),
        );
    }
  }

  return client as Client<M>;
}

export const planRegistryMethods = {
  getPlan: readMethod<[planId: number | bigint], Plan>(
    "get_plan",
    "plan_registry",
    (planId) => [arg.u64(planId)],
  ),
  createPlan: writeMethod<[params: CreatePlanParams]>(
    "create_plan",
    "plan_registry",
    (source, params) => [
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
  setPlanActive: writeMethod<[planId: number | bigint, active: boolean]>(
    "set_plan_active",
    "plan_registry",
    (source, planId, active) => [
      arg.address(source),
      arg.u64(planId),
      arg.bool(active),
    ],
  ),
  deactivatePage: writeMethod<[start: number, limit: number]>(
    "deactivate_page",
    "plan_registry",
    (source, start, limit) => [
      arg.address(source),
      arg.u32(start),
      arg.u32(limit),
    ],
  ),
  merchantPlanCount: readMethod<[merchant: string], number>(
    "merchant_plan_count",
    "plan_registry",
    (merchant) => [arg.address(merchant)],
  ),
  merchantPlans: readMethod<
    [merchant: string, start: number, limit: number],
    bigint[]
  >("merchant_plans", "plan_registry", (merchant, start, limit) => [
    arg.address(merchant),
    arg.u32(start),
    arg.u32(limit),
  ]),
  /** Plans are numbered from 1, so this minus one is how many exist. */
  nextPlanId: readMethod<[], bigint>(
    "next_plan_id",
    "plan_registry",
    () => [],
  ),
  /**
   * Proposed payflow-contract#16. Only call when `supportsPlanRename` confirms
   * the deployed registry carries the method.
   */
  setPlanName: writeMethod<[planId: number | bigint, name: string]>(
    "set_plan_name",
    "plan_registry",
    (source, planId, name) => [
      arg.address(source),
      arg.u64(planId),
      arg.string(name),
    ],
  ),
  /**
   * Paged plan ids, oldest first. The registry limits one call to `MAX_PAGE`
   * ids.
   */
  listPlans: readMethod<[start: number | bigint], bigint[]>(
    "list_plans",
    "plan_registry",
    (start) => [arg.u64(start)],
  ),
  /** The merchant's own profile, or the registry's ProfileNotFound error (#8). */
  getProfile: readMethod<[], { name?: unknown; url?: unknown }>(
    "profile",
    "plan_registry",
    () => [],
  ),
  setProfile: writeMethod<[name: string, url: string]>(
    "set_profile",
    "plan_registry",
    (source, name, url) => [
      arg.address(source),
      arg.string(name),
      arg.string(url),
    ],
  ),
};

export const vaultMethods = {
  vaultBalance: readMethod<[user: string, token: string], bigint>(
    "balance",
    "vault",
    (user, token) => [arg.address(user), arg.address(token)],
  ),
  deposit: writeMethod<[token: string, amount: bigint]>(
    "deposit",
    "vault",
    (source, token, amount) => [
      arg.address(source),
      arg.address(token),
      arg.i128(amount),
    ],
  ),
  withdraw: writeMethod<[token: string, amount: bigint]>(
    "withdraw",
    "vault",
    (source, token, amount) => [
      arg.address(source),
      arg.address(token),
      arg.i128(amount),
    ],
  ),
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
  depositFor: writeMethod<[recipient: string, token: string, amount: bigint]>(
    "deposit_for",
    "vault",
    (_source, recipient, token, amount) => [
      arg.address(recipient),
      arg.address(token),
      arg.i128(amount),
    ],
  ),
};

export const subscriptionMethods = {
  // Proposed read interface for #25's open-mandate counter. Callers must
  // tolerate missing support until the contract ships this getter.
  planSubscriberCount: readMethod<[planId: number | bigint], number>(
    "plan_subscriber_count",
    "subscription",
    (planId) => [arg.u64(planId)],
  ),
  getMandate: readMethod<[mandateId: number | bigint], Mandate>(
    "get_mandate",
    "subscription",
    (mandateId) => [arg.u64(mandateId)],
  ),
  /**
   * The protocol's current fee, in basis points. Read live rather than hardcoded
   * so a merchant previewing a fee split sees the rate their subscribers will
   * actually be charged: the contract freezes `fee_bps` into each mandate at
   * subscribe time, but an admin can change it between mandates.
   */
  feeBps: readMethod<[], number>("fee_bps", "subscription", () => []),
  // Index getters are paged: at most MAX_PAGE ids per call, oldest first.
  subscriberMandateCount: readMethod<[subscriber: string], number>(
    "subscriber_mandate_count",
    "subscription",
    (subscriber) => [arg.address(subscriber)],
  ),
  subscriberMandates: readMethod<
    [subscriber: string, start: number, limit: number],
    bigint[]
  >("subscriber_mandates", "subscription", (subscriber, start, limit) => [
    arg.address(subscriber),
    arg.u32(start),
    arg.u32(limit),
  ]),
  merchantMandateCount: readMethod<[merchant: string], number>(
    "merchant_mandate_count",
    "subscription",
    (merchant) => [arg.address(merchant)],
  ),
  merchantMandates: readMethod<
    [merchant: string, start: number, limit: number],
    bigint[]
  >("merchant_mandates", "subscription", (merchant, start, limit) => [
    arg.address(merchant),
    arg.u32(start),
    arg.u32(limit),
  ]),
  isDue: readMethod<[mandateId: number | bigint], boolean>(
    "is_due",
    "subscription",
    (mandateId) => [arg.u64(mandateId)],
  ),
  /**
   * Proposed payflow-contract#28. Returns null when the deployed contract
   * predates `get_spend_limit`; the caller hides the control in that case.
   */
  getSpendLimit: readMethod<[mandateId: number | bigint], number | null>(
    "get_spend_limit",
    "subscription",
    (mandateId) => [arg.u64(mandateId)],
  ),
  /**
   * `max_charges` is settled with `set_max_charges` after subscribing, so the
   * argument is part of the call signature but not of the contract call.
   */
  subscribe: writeMethod<[planId: number | bigint, maxCharges: number]>(
    "subscribe",
    "subscription",
    (source, planId) => [arg.address(source), arg.u64(planId)],
  ),
  cancel: writeMethod<[mandateId: number | bigint]>(
    "cancel",
    "subscription",
    (source, mandateId) => [arg.address(source), arg.u64(mandateId)],
  ),
  pause: writeMethod<[mandateId: number | bigint]>(
    "pause",
    "subscription",
    (source, mandateId) => [arg.address(source), arg.u64(mandateId)],
  ),
  resume: writeMethod<[mandateId: number | bigint]>(
    "resume",
    "subscription",
    (source, mandateId) => [arg.address(source), arg.u64(mandateId)],
  ),
  /**
   * Proposed payflow-contract#28. The contract rejects a cap below
   * `charges_made`, so callers validate before submitting.
   */
  setMaxCharges: writeMethod<[mandateId: number | bigint, maxCharges: number | bigint]>(
    "set_max_charges",
    "subscription",
    (source, mandateId, maxCharges) => [
      arg.address(source),
      arg.u64(mandateId),
      arg.u32(Number(maxCharges)),
    ],
  ),
  /**
   * Paged mandate ids, oldest first. The subscription contract limits one call
   * to `MAX_PAGE` ids.
   */
  listMandatesBySubscriber: readMethod<
    [subscriber: string, start: number | bigint],
    bigint[]
  >("list_mandates_by_subscriber", "subscription", (subscriber, start) => [
    arg.address(subscriber),
    arg.u64(start),
  ]),
  listMandatesByMerchant: readMethod<
    [merchant: string, start: number | bigint],
    bigint[]
  >("list_mandates_by_merchant", "subscription", (merchant, start) => [
    arg.address(merchant),
    arg.u64(start),
  ]),
  /** Merchant side: permanently stop billing one of the merchant's mandates. */
  endMandate: writeMethod<[mandateId: number | bigint]>(
    "end_mandate",
    "subscription",
    (source, mandateId) => [arg.address(source), arg.u64(mandateId)],
  ),
  setPaused: writeMethod<[mandateId: number | bigint, paused: boolean]>(
    "set_paused",
    "subscription",
    (_source, mandateId, paused) => [arg.u64(mandateId), arg.bool(paused)],
  ),
  /**
   * Subscriber side: pause billing until a point in time, from the interface
   * proposed in payflow-contract#41. Only callable against a contract that
   * carries `pause_until` — see `mandatePauseUntil`, which is how the UI
   * decides whether to offer this at all.
   */
  pauseUntil: writeMethod<[mandateId: number | bigint, untilUnixSeconds: number]>(
    "pause_until",
    "subscription",
    (source, mandateId, untilUnixSeconds) => [
      arg.address(source),
      arg.u64(mandateId),
      arg.u64(untilUnixSeconds),
    ],
  ),
  /**
   * Merchant side: attach a discount to one of the merchant's mandates.
   *
   * Built against the interface proposed in payflow-contract#37: the
   * discount is a rate in basis points and covers a number of charges. The
   * contract charges the discounted amount for those charges and the full
   * price afterwards; a discount can only lower the price.
   */
  setDiscount: writeMethod<
    [mandateId: number | bigint, discountBps: number, discountCharges: number]
  >("set_discount", "subscription", (_source, mandateId, discountBps, discountCharges) => [
    arg.u64(mandateId),
    arg.u32(discountBps),
    arg.u32(discountCharges),
  ]),
  /** Permissionless: anyone may settle a due mandate. */
  charge: writeMethod<[mandateId: number | bigint]>(
    "charge",
    "subscription",
    (_source, mandateId) => [arg.u64(mandateId)],
  ),
  /**
   * Merchant side: issue a refund on one of the merchant's mandates.
   *
   * Built against the interface proposed in payflow-contract#36: the refund
   * is linked to a mandate and specifies the amount to return to the
   * subscriber. The amount is capped at what the merchant received (net of
   * fees) for that mandate.
   */
  refund: writeMethod<[mandateId: number | bigint, amount: bigint]>(
    "refund",
    "subscription",
    (source, mandateId, amount) => [
      arg.address(source),
      arg.u64(mandateId),
      arg.i128(amount),
    ],
  ),
  /**
   * Subscriber side: propose moving this mandate to a new wallet.
   *
   * Built against the interface proposed in payflow-contract#68:
   * `transfer_mandate(subscriber: Address, mandate_id: u64, new_subscriber:
   * Address)`. Only call this when `mandateSupportsTransfer` confirms the
   * deployed contract carries the field.
   */
  transferMandate: writeMethod<[mandateId: number | bigint, newSubscriber: string]>(
    "transfer_mandate",
    "subscription",
    (source, mandateId, newSubscriber) => [
      arg.address(source),
      arg.u64(mandateId),
      arg.address(newSubscriber),
    ],
  ),
  /**
   * New wallet side: accept a pending transfer of a mandate to the caller.
   *
   * Built against the interface proposed in payflow-contract#68:
   * `accept_mandate_transfer(new_subscriber: Address, mandate_id: u64)`. The
   * contract only accepts when the mandate's `pending_subscriber` matches the
   * caller.
   */
  acceptMandateTransfer: writeMethod<[mandateId: number | bigint]>(
    "accept_mandate_transfer",
    "subscription",
    (source, mandateId) => [arg.address(source), arg.u64(mandateId)],
  ),
};
