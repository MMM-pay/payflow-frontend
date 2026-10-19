import { config } from "./config";

export interface ApiPlan {
  id: number;
  merchant: string;
  /** Merchant-set label. Empty for plans created before names shipped. */
  name: string;
  token: string;
  amount: string;
  period: number;
  active: number;
  ledger: number;
  /**
   * Free trial in seconds, 0 meaning none.
   *
   * Optional on purpose: payflow-contract#9 has not shipped, so neither the
   * deployed `Plan` nor the indexer's rows carry it yet. `undefined` means
   * "this source cannot say", which is not the same as 0 — see `supportsTrials`.
   */
  trial?: number;
  /** Proposed #26 Unix-seconds cutoff; 0 is forever, absent is unsupported. */
  available_until?: number;
  /** Proposed #25 cap; 0 is unlimited, absent is unsupported. */
  max_subscribers?: number;
  /** Open mandates (including paused), not lifetime subscriptions. */
  subscriber_count?: number;
}

export interface ApiMandate {
  id: number;
  subscriber: string;
  merchant: string;
  plan_id: number;
  amount: string;
  period: number;
  next_charge: number;
  last_charge: number;
  charges_made: number;
  max_charges: number;
  /** Fee rate frozen at subscribe time; an admin change cannot move it. */
  fee_bps: number;
  status: string;
  /**
   * Token the amount is denominated in. Only the contract fallback fills this
   * in; the indexer does not serve it, so callers must fall back to the
   * configured token when it is absent.
   */
  token?: string;
  /** Who cancelled the mandate: "subscriber", "merchant", or null. */
  ended_by?: string | null;
  /**
   * The plan's trial in seconds, frozen into the mandate at subscribe time and
   * projected by the indexer from the `Subscribed` event payflow-contract#9
   * adds. Optional for the same reason as `ApiPlan.trial`: absent means the
   * source cannot say, which is not the same as zero.
   */
  trial?: number;
  /**
   * When a paused mandate resumes, as a Unix time, from payflow-contract#41.
   *
   * Optional because the field has not shipped: the contract only reports it
   * once the dated pause exists, and the indexer only serves what the contract
   * emits. Absent therefore means "this source cannot pause until a date",
   * which is what the account page uses to hide the control.
   */
  pause_until?: number;
  /**
   * The discount the merchant set on this mandate, in basis points, and how
   * many charges it covers.
   *
   * Optional for the same reason: payflow-contract#37 has not shipped, so
   * neither the deployed contract's `Mandate` nor the indexer's rows carry
   * them. Absent means the source cannot say — see `supportsDiscounts`.
   */
  discount_bps?: number;
  discount_charges?: number;
  /** How many of the discounted charges have been settled. */
  discount_charges_made?: number;
}

export interface ApiCharge {
  tx_hash: string;
  mandate_id: number;
  amount: string;
  fee: string;
  charges_made: number;
  ledger: number;
}

export type VaultEventType = "deposit" | "withdraw" | "debit";

export interface ApiVaultEvent {
  type: VaultEventType;
  /** Amount in smallest units (stroops), as a decimal string. Always a positive magnitude; the sign is derived from `type`. */
  amount: string;
  tx_hash: string;
  ledger: number;
}

/**
 * Per-plan performance stats, proposed by payflow-backend#29.
 *
 * Optional fields are absent when the backend does not yet serve this endpoint
 * or when the data is unavailable. Callers must treat `undefined` as "cannot
 * say" rather than zero.
 *
 * `total_collected` is in smallest units (stroops) as a decimal string so
 * bigint math is always used — never floats.
 */
export interface ApiPlanStats {
  /** Open mandates (active + paused). */
  subscriber_count: number;
  /** Net of the protocol fee, in smallest units as a decimal string. */
  total_collected: string;
  /** Mandates ended by either party. */
  cancellations: number;
}

export interface MerchantSummary {
  merchant: string;
  activeMandates: number;
  /** null when served from chain fallback: charge history lives only in the indexer. */
  totalCollected: string | null;
  chargeCount: number;
  mrr: string;
}

export interface ProtocolStats {
  plans: number;
  mandates: number;
  activeMandates: number;
  charges: number;
  lastIndexedLedger: number;
}

/**
 * The indexer is a convenience, not a source of truth. Every call here is
 * allowed to fail: the UI falls back to reading contract state directly so the
 * app still works when the backend is down.
 */
async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${config.apiUrl}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const api = {
  stats: () => get<ProtocolStats>("/api/stats"),
  plans: (merchant?: string) =>
    get<{ plans: ApiPlan[] }>(`/api/plans${merchant ? `?merchant=${merchant}` : ""}`),
  mandatesOf: (subscriber: string) =>
    get<{ mandates: ApiMandate[] }>(`/api/mandates?subscriber=${subscriber}`),
  mandatesFor: (merchant: string) =>
    get<{ mandates: ApiMandate[] }>(`/api/mandates?merchant=${merchant}`),
  charges: (mandateId: number) =>
    get<{ charges: ApiCharge[] }>(`/api/mandates/${mandateId}/charges`),
  vaultHistory: (address: string) =>
    get<{ events: ApiVaultEvent[] }>(`/api/vaults/${address}/history`),
  merchantSummary: (address: string) =>
    get<MerchantSummary>(`/api/merchants/${address}/summary`),
  /**
   * Revenue over time, proposed by payflow-backend#12 and not deployed yet.
   *
   * Shape kept loose on purpose (`unknown`, not a declared interface) so the
   * dashboard can tell "this backend does not serve the endpoint" from "this
   * merchant earned nothing"; `parseRevenue` in `lib/revenue` does the reading.
   */
  merchantRevenue: (
    address: string,
    params: { bucket?: string; from?: number; to?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (params.bucket) query.set("bucket", params.bucket);
    if (params.from !== undefined) query.set("from", String(params.from));
    if (params.to !== undefined) query.set("to", String(params.to));
    const qs = query.toString();
    return get<unknown>(`/api/merchants/${address}/revenue${qs ? `?${qs}` : ""}`);
  },
  due: () => get<{ now: number; due: ApiMandate[] }>("/api/due"),
  /**
   * Per-plan stats, proposed by payflow-backend#29.
   *
   * Returns null when the backend is unreachable or does not yet serve this
   * endpoint — the UI must hide the stats section rather than show stale zeros.
   */
  planStats: (planId: number) => get<ApiPlanStats>(`/api/plans/${planId}/stats`),
};
