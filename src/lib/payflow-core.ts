/**
 * Contract constants, types and pure helpers with NO Stellar SDK dependency.
 *
 * `payflow.ts` imports `@stellar/stellar-sdk`, a graph of roughly half a
 * megabyte raw. Pages need `MAX_NAME_LEN`, `mandateStatus`, the `Plan` /
 * `Mandate` shapes and `MAX_PAGE` during render — before any network call —
 * so those live here: importing them from `payflow.ts` would drag the whole
 * SDK into every wallet page's first-load bundle. Everything in this file is
 * pure and cheap enough to ship on the critical path.
 */

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
