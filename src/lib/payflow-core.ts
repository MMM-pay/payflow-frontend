/**
 * The parts of the contract layer that need no Stellar SDK: the types, the
 * limits the contracts enforce, the mandate readers and the error tables.
 *
 * They live apart from `payflow.ts` because importing that module pulls the
 * SDK (~570 kB) into a page's first-load bundle, and most pages only need a
 * constant or a decoded error message. `payflow.ts` re-exports everything
 * here, so existing callers and tests keep one import site.
 */
import { mandateStatus } from "./mandate-status";
import { MIN_PERIOD_MESSAGE } from "./period";
import { isSignatureRejection, SIGNATURE_CANCELLED_MESSAGE } from "./signature-error";
// StrKey is a self-contained checksum helper: importing it does not pull the
// RPC client or the transaction builder into a page's bundle.
// `/base` is the SDK without the RPC client or transaction builder: StrKey is
// a self-contained checksum helper, so importing it must not cost a bundle.
import { StrKey } from "@stellar/stellar-sdk/base";

export { mandateStatus };

/** Signs a transaction XDR and returns the signed XDR. Supplied by the wallet. */
export type SignXdr = (xdrString: string) => Promise<string>;

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
