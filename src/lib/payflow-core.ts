/**
 * Contract constants, types and pure helpers that pages render with.
 *
 * `payflow.ts` imports `@stellar/stellar-sdk`, a graph of roughly half a
 * megabyte raw. Pages need `MAX_NAME_LEN`, `mandateStatus`, `mandatePauseUntil`,
 * the `Plan` / `Mandate` shapes and `MAX_PAGE` while rendering — before any
 * network call — so those live here: importing them from `payflow.ts` would
 * drag the whole SDK into every wallet page's first-load bundle. Everything in
 * this file is pure and cheap enough to ship on the critical path. The only
 * SDK piece it touches is `StrKey` from the SDK's small `/base` entry, used to
 * check an address without pulling the rest in.
 */

import { StrKey } from "@stellar/stellar-sdk/base";

/** Signs a transaction XDR and returns the signed XDR. Supplied by the wallet. */
export type SignXdr = (xdrString: string) => Promise<string>;

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
  /** Proposed payflow-contract#26; absent on older deployments. */
  available_until?: bigint;
  /** Proposed payflow-contract#25; 0 means unlimited. */
  max_subscribers?: number;
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

/** A Stellar account a sponsor can pay into: a valid ed25519 public key. */
export function validateRecipient(recipient: string): string | null {
  const trimmed = recipient.trim();
  if (!trimmed) return "Enter a Stellar address.";
  return StrKey.isValidEd25519PublicKey(trimmed)
    ? null
    : "That is not a valid Stellar account address.";
}
