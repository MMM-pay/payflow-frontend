import { MAX_PAGE, mandateStatus, payflow, type Mandate, type Plan } from "./payflow";
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

/** How many of the newest plans the contract-only fallback lists. */
const MAX_PLAN_PROBE = 24;

/** How many of the newest entries of an index the fallback reads. */
const MAX_INDEX_READ = 2 * MAX_PAGE;

function planToApi(plan: Plan): ApiPlan {
  return {
    id: Number(plan.id),
    merchant: plan.merchant,
    name: plan.name,
    token: plan.token,
    amount: plan.amount.toString(),
    period: Number(plan.period),
    active: plan.active ? 1 : 0,
    ledger: 0,
  };
}

/** Exported for tests. */
export function mandateToApi(mandate: Mandate): ApiMandate {
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
    fee_bps: mandate.fee_bps,
    status: mandateStatus(mandate.status),
    // Contract state does not record who cancelled; only the indexer knows.
    ended_by: null,
  };
}

async function settledValues<T>(promises: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(promises);
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

/**
 * Page positions that cover the newest `want` of `count` index entries, as
 * [start, limit] pairs of at most `pageSize`. Exported for tests.
 */
export function newestPages(count: number, want: number, pageSize = MAX_PAGE): [number, number][] {
  const from = Math.max(0, count - want);
  const pages: [number, number][] = [];
  for (let start = from; start < count; start += pageSize) {
    pages.push([start, Math.min(pageSize, count - start)]);
  }
  return pages;
}

/** Read the newest ids from a paged contract index. */
async function newestIds(
  count: number,
  page: (start: number, limit: number) => Promise<bigint[]>,
): Promise<bigint[]> {
  const pages = await Promise.all(
    newestPages(count, MAX_INDEX_READ).map(([start, limit]) => page(start, limit)),
  );
  return pages.flat();
}

/**
 * The newest plans, read by id.
 *
 * The registry has no "list all" function (that is the gap the indexer fills),
 * but ids are sequential and `next_plan_id` says where they end, so this reads
 * the newest few. Bounded deliberately: an unbounded read would hammer RPC.
 */
export async function chainPlans(source: string): Promise<ApiPlan[]> {
  const next = Number(await payflow.nextPlanId(source));
  const newest = Math.min(MAX_PLAN_PROBE, Math.max(0, next - 1));
  const ids = Array.from({ length: newest }, (_, i) => next - 1 - i);
  const found = await settledValues(ids.map((id) => payflow.getPlan(source, id)));
  return found.map(planToApi).sort((a, b) => b.id - a.id);
}

export async function chainPlansOf(source: string, merchant: string): Promise<ApiPlan[]> {
  const count = await payflow.merchantPlanCount(source, merchant);
  const ids = await newestIds(count, (s, l) => payflow.merchantPlans(source, merchant, s, l));
  const plans = await settledValues(ids.map((id) => payflow.getPlan(source, id)));
  return plans.map(planToApi).sort((a, b) => b.id - a.id);
}

export async function chainMandatesOf(
  source: string,
  subscriber: string,
): Promise<ApiMandate[]> {
  const count = await payflow.subscriberMandateCount(source, subscriber);
  const ids = await newestIds(count, (s, l) =>
    payflow.subscriberMandates(source, subscriber, s, l),
  );
  const mandates = await settledValues(ids.map((id) => payflow.getMandate(source, id)));
  return mandates.map(mandateToApi).sort((a, b) => b.id - a.id);
}

export async function chainMandatesFor(
  source: string,
  merchant: string,
): Promise<ApiMandate[]> {
  const count = await payflow.merchantMandateCount(source, merchant);
  const ids = await newestIds(count, (s, l) => payflow.merchantMandates(source, merchant, s, l));
  const mandates = await settledValues(ids.map((id) => payflow.getMandate(source, id)));
  return mandates.map(mandateToApi).sort((a, b) => b.id - a.id);
}

/** A merchant can end a mandate that could still be charged. */
export function endable(m: Pick<ApiMandate, "status">): boolean {
  return m.status === "Active" || m.status === "Paused";
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
