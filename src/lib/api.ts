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
}

export interface ApiCharge {
  tx_hash: string;
  mandate_id: number;
  amount: string;
  fee: string;
  charges_made: number;
  ledger: number;
}

export type ApiActivityType =
  | "subscribed"
  | "charged"
  | "pause_changed"
  | "cancelled"
  | "mandate_ended"
  | "mandate_completed";

export interface ApiTimelineEvent {
  event_id: string;
  mandate_id: number;
  type: ApiActivityType;
  ledger: number;
  event_index?: number;
  timestamp?: number | null;
  tx_hash?: string | null;
  amount?: string | null;
  fee?: string | null;
  token?: string | null;
  token_symbol?: string | null;
  token_decimals?: number | null;
}

export interface ApiTimelinePage {
  events: ApiTimelineEvent[];
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

const TIMELINE_TYPES = new Set<ApiActivityType>([
  "subscribed",
  "charged",
  "pause_changed",
  "cancelled",
  "mandate_ended",
  "mandate_completed",
]);

function isIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isNullableNonEmptyString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || (typeof value === "string" && value.trim().length > 0);
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isTimelineEvent(value: unknown, mandateId: number): value is ApiTimelineEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  const decimals = event.token_decimals;
  const metadataPresent =
    hasValue(event.token) || hasValue(event.token_symbol) || hasValue(decimals);
  const metadataValid = metadataPresent
    ? typeof event.token === "string" &&
      event.token.trim().length > 0 &&
      typeof event.token_symbol === "string" &&
      event.token_symbol.trim().length > 0 &&
      typeof decimals === "number" &&
      Number.isInteger(decimals) &&
      decimals >= 0 &&
      decimals <= 18
    : true;
  return (
    typeof event.event_id === "string" &&
    event.event_id.trim().length > 0 &&
    typeof event.mandate_id === "number" &&
    Number.isSafeInteger(event.mandate_id) &&
    event.mandate_id > 0 &&
    event.mandate_id === mandateId &&
    typeof event.type === "string" &&
    TIMELINE_TYPES.has(event.type as ApiActivityType) &&
    typeof event.ledger === "number" &&
    Number.isSafeInteger(event.ledger) &&
    event.ledger > 0 &&
    (event.event_index === undefined ||
      (typeof event.event_index === "number" &&
        Number.isSafeInteger(event.event_index) &&
        event.event_index >= 0)) &&
    (event.timestamp === undefined ||
      event.timestamp === null ||
      (typeof event.timestamp === "number" && Number.isSafeInteger(event.timestamp) && event.timestamp >= 0)) &&
    isNullableNonEmptyString(event.tx_hash) &&
    (event.amount === undefined || event.amount === null || isIntegerString(event.amount)) &&
    (event.fee === undefined || event.fee === null || isIntegerString(event.fee)) &&
    isNullableNonEmptyString(event.token) &&
    isNullableNonEmptyString(event.token_symbol) &&
    metadataValid
  );
}

async function timeline(mandateId: number): Promise<ApiTimelinePage | null> {
  const response = await get<unknown>(`/api/mandates/${mandateId}/timeline`);
  if (!response || typeof response !== "object") return null;
  const events = (response as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;
  const validEvents: ApiTimelineEvent[] = [];
  for (const event of events) {
    if (!isTimelineEvent(event, mandateId)) return null;
    validEvents.push(event);
  }
  return { events: validEvents };
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
  timeline,
  merchantSummary: (address: string) =>
    get<MerchantSummary>(`/api/merchants/${address}/summary`),
  due: () => get<{ now: number; due: ApiMandate[] }>("/api/due"),
};
