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
}

export interface ApiCharge {
  tx_hash: string;
  mandate_id: number;
  amount: string;
  fee: string;
  charges_made: number;
  ledger: number;
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
  merchantSummary: (address: string) =>
    get<MerchantSummary>(`/api/merchants/${address}/summary`),
  due: () => get<{ now: number; due: ApiMandate[] }>("/api/due"),
};
