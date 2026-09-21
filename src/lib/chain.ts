import { payflow, type Mandate, type Plan } from "./payflow";
import type { ApiMandate, ApiPlan, MerchantSummary } from "./api";

/**
 * Contract-only fallbacks for the lists the indexer normally serves.
 *
 * These exist so the app stays usable when `payflow-backend` is unreachable —
 * including the public demo deployment, which has no backend at all. They read
 * straight from contract state via simulation, so they are slower and cannot
 * aggregate, but they are always correct: the contract is the source of truth
 * and the indexer is only ever a cache of it.
 */

/** Plan ids are assigned sequentially from 1, so a bounded probe enumerates them. */
const MAX_PLAN_PROBE = 24;

function planToApi(plan: Plan): ApiPlan {
  return {
    id: Number(plan.id),
    merchant: plan.merchant,
    token: plan.token,
    amount: plan.amount.toString(),
    period: Number(plan.period),
    active: plan.active ? 1 : 0,
    ledger: 0,
  };
}

function mandateToApi(mandate: Mandate): ApiMandate {
  return {
    id: Number(mandate.id),
    subscriber: mandate.subscriber,
    merchant: mandate.merchant,
    plan_id: Number(mandate.plan_id),
    amount: mandate.amount.toString(),
    period: Number(mandate.period),
    next_charge: Number(mandate.next_charge),
    last_charge: Number(mandate.last_charge),
    charges_made: mandate.charges_made,
    max_charges: mandate.max_charges,
    status: mandate.status,
  };
}

async function settledValues<T>(promises: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(promises);
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

/**
 * Enumerate plans by probing sequential ids.
 *
 * The registry has no "list all" function — that is exactly the gap the indexer
 * fills — so this walks ids until it stops finding plans. Bounded deliberately:
 * a demo has a handful of plans, and an unbounded probe would hammer RPC.
 */
export async function chainPlans(source: string): Promise<ApiPlan[]> {
  const found = await settledValues(
    Array.from({ length: MAX_PLAN_PROBE }, (_, i) => payflow.getPlan(source, i + 1)),
  );
  return found.map(planToApi).sort((a, b) => b.id - a.id);
}

export async function chainPlansOf(source: string, merchant: string): Promise<ApiPlan[]> {
  const ids = await payflow.merchantPlans(source, merchant);
  const plans = await settledValues(ids.map((id) => payflow.getPlan(source, id)));
  return plans.map(planToApi).sort((a, b) => b.id - a.id);
}

export async function chainMandatesOf(
  source: string,
  subscriber: string,
): Promise<ApiMandate[]> {
  const ids = await payflow.subscriberMandates(source, subscriber);
  const mandates = await settledValues(ids.map((id) => payflow.getMandate(source, id)));
  return mandates.map(mandateToApi).sort((a, b) => b.id - a.id);
}

export async function chainMandatesFor(
  source: string,
  merchant: string,
): Promise<ApiMandate[]> {
  const ids = await payflow.merchantMandates(source, merchant);
  const mandates = await settledValues(ids.map((id) => payflow.getMandate(source, id)));
  return mandates.map(mandateToApi).sort((a, b) => b.id - a.id);
}

/** Merchant totals derived from mandates alone. Charge history needs the indexer. */
export function chainMerchantSummary(
  address: string,
  mandates: ApiMandate[],
): MerchantSummary {
  const active = mandates.filter((m) => m.status === "Active");
  const mrr = active.reduce(
    (sum, m) => sum + (BigInt(m.amount) * 2_592_000n) / BigInt(m.period || 1),
    0n,
  );
  return {
    merchant: address,
    activeMandates: active.length,
    // Charge history lives in the indexer; without it, report what is knowable.
    totalCollected: null,
    chargeCount: mandates.reduce((n, m) => n + m.charges_made, 0),
    mrr: mrr.toString(),
  };
}
