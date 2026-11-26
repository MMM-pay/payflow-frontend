"use client";

import { useI18n } from "@/i18n/provider";
import type { Translation } from "@/i18n/translate";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as navigation from "next/navigation";
import { useSearchParams } from "next/navigation";
import { api, type ApiPlan } from "@/lib/api";
import { chainPlans } from "@/lib/chain";
import { config } from "@/lib/config";
// The SDK-backed contract module loads on demand, so the Stellar SDK
// stays out of this route's first-load bundle.
import { payflow } from "@/lib/lazy-payflow";
import { planParam } from "@/lib/share";
import { useWallet } from "@/lib/wallet";
import type { TokenMeta } from "@/lib/format";
import { trialSeconds } from "@/lib/trial";
import { availabilityInteger, planAvailability } from "@/lib/availability";
import {
  COMPARE_LIMIT,
  planMonthlyEquivalent,
  plansForComparison,
  togglePlanComparison,
} from "@/lib/compare";
import { metaFor, useTokenMetas } from "@/lib/token";
import { filterAndSortPlans, type PlanPeriodOption, type PlanSortOption } from "@/lib/plans";
import { formatUsdEstimate, formatUsdcEstimate, useXlmUsdPrice } from "@/lib/price";
import { checkChargeLimit, confirmationFor } from "@/lib/subscribe-confirmation";
import { observeContractRecord } from "@/lib/contract-compat";
import { Empty, MerchantAccount, Notice, Panel, SkeletonPlanCards, TimeAgo, TxLink } from "@/components/ui";
import { useAction } from "@/lib/useAction";
import { Search } from "@/components/Search";
import { SubscriberGuide } from "@/components/SubscriberGuide";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ContractVersionNotice } from "@/components/ContractVersionNotice";
import { DepositCoverageInput } from "@/components/DepositCoverageInput";
import { LoadingButton } from "@/components/LoadingButton";

/** Remaining seats in words, without inventing a count the source cannot provide. */
function seatsLabel(plan: ApiPlan, now: number, tr: Translation): string {
  const availability = planAvailability(plan, now);
  if (availability.seats !== null) {
    return tr(availability.seats === 1 ? "{0} seat left" : "{0} seats left", { 0: availability.seats });
  }
  const cap = availabilityInteger(plan.max_subscribers);
  if (cap && cap > 0) return tr("Count unavailable");
  return tr("Unlimited");
}

/**
 * The comparison itself is a real table: plan names are column headers and
 * each attribute is a row header, so a screen reader announces "Price,
 * Monthly Software, 5 XLM" instead of an undifferentiated run of cells. The
 * scroll container is focusable and labelled for narrow screens, where the
 * three columns cannot fit without horizontal scrolling.
 */
function ComparisonTable({
  plans,
  metas,
  now,
}: {
  plans: ApiPlan[];
  metas: Map<string, TokenMeta>;
  now: number;
}) {
  const { t: tr, formatPeriod, formatAmount, formatTokenValue, formatTrialLength, formatNumber } = useI18n();
  return (
    <div
      className="mt-3 overflow-x-auto rounded-lg border border-edge focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      tabIndex={0}
      role="region"
      aria-label={tr("Plan comparison, scroll horizontally if needed")}
    >
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <caption className="sr-only">{tr("Side-by-side comparison of")}{" "}{formatNumber(plans.length)}{" "}{tr("selected plans")}</caption>
        <thead>
          <tr className="border-b border-edge bg-fg/5">
            <th scope="col" className="px-3 py-2 text-start font-medium text-muted">{tr("Feature")}</th>
            {plans.map((plan) => (
              <th key={plan.id} scope="col" className="px-3 py-2 text-start font-semibold">
                {plan.name ||tr("Plan #{0}", { "0": plan.id })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-edge/60">
            <th scope="row" className="px-3 py-2 text-start font-medium text-muted">{tr("Price")}</th>
            {plans.map((plan) => {
              const meta = metaFor(metas, plan.token);
              return (
                <td key={plan.id} className="px-3 py-2 tabular-nums">
                  {formatTokenValue(plan.amount, 4, meta.decimals)}{" "}
                  <span className="text-xs text-muted">{meta.symbol}</span>
                </td>
              );
            })}
          </tr>
          <tr className="border-b border-edge/60">
            <th scope="row" className="px-3 py-2 text-start font-medium text-muted">{tr("Billing period")}</th>
            {plans.map((plan) => (
              <td key={plan.id} className="px-3 py-2">
                {formatPeriod(plan.period)}
              </td>
            ))}
          </tr>
          <tr className="border-b border-edge/60">
            <th scope="row" className="px-3 py-2 text-start font-medium text-muted">{tr("Monthly equivalent")}<span className="block text-xs font-normal">{tr("30-day month")}</span>
            </th>
            {plans.map((plan) => {
              const meta = metaFor(metas, plan.token);
              const monthly = planMonthlyEquivalent(plan);
              return (
                <td key={plan.id} className="px-3 py-2 tabular-nums">
                  {monthly === null ? "—" : formatAmount(monthly, meta)}
                </td>
              );
            })}
          </tr>
          <tr className="border-b border-edge/60">
            <th scope="row" className="px-3 py-2 text-start font-medium text-muted">{tr("Free trial")}</th>
            {plans.map((plan) => {
              const trial = trialSeconds(plan);
              return (
                <td key={plan.id} className="px-3 py-2">
                  {plan.trial === undefined
                    ?tr("Not reported")
                    : trial > 0
                      ? formatTrialLength(trial)
                      :tr("None")}
                </td>
              );
            })}
          </tr>
          <tr className="border-b border-edge/60">
            <th scope="row" className="px-3 py-2 text-start font-medium text-muted">{tr("Seats")}</th>
            {plans.map((plan) => (
              <td key={plan.id} className="px-3 py-2">
                {seatsLabel(plan, now, tr)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="px-3 py-2 text-start font-medium text-muted">{tr("Merchant")}</th>
            {plans.map((plan) => (
              <td key={plan.id} className="px-3 py-2">
                <MerchantAccount value={plan.merchant} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function usePrefetchRouter() {
  if ("useRouter" in navigation) {
    try {
      const getRouter = (navigation as Record<string, unknown>)["useRouter"];
      if (typeof getRouter === "function") {
        return (getRouter as () => { prefetch?: (url: string) => void })() ?? null;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function SubscribeInner() {
  const { t: tr, formatPeriod, formatDate, formatWhen, translateMessage, formatTrialLength, trialBadge, formatTokenValue, formatUsdString, formatNumber, formatAmount, formatFeeBps } = useI18n();
  const router = usePrefetchRouter();
  const prefetchPlan = useCallback(
    (planId: number) => {
      try {
        if (router && typeof router.prefetch === "function") {
          router.prefetch(`/subscribe/?plan=${planId}`);
        }
      } catch {
        // ignore
      }
    },
    [router],
  );
  const searchParams = useSearchParams();
  const sortParam = (searchParams?.get("sort") as PlanSortOption) || "newest";
  // A shared link (?plan=12) shows that one plan instead of the catalogue.
  const shared = planParam(searchParams?.get("plan"));
  const periodParam = (searchParams?.get("period") as PlanPeriodOption) || "all";
  const queryParam = searchParams?.get("q") ?? "";
  const tokenParam = searchParams?.get("token") ?? "all";

  const [sort, setSort] = useState<PlanSortOption>(sortParam);
  const [period, setPeriod] = useState<PlanPeriodOption>(periodParam);
  const [query, setQuery] = useState(queryParam);
  const [tokenFilter, setTokenFilter] = useState(tokenParam);
  const [loadFailed, setLoadFailed] = useState(false);
  // Plans ticked for the side-by-side table, in the order they were picked.
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  const { address, networkMismatch, signXdr, signing } = useWallet();
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  /**
   * Per-plan stats keyed by plan id, populated from the stats API.
   *
   * A missing key means the fetch for that plan has not returned yet — the
   * card shows a loading placeholder rather than a misleading zero.
   * `null` means neither the API nor any source could supply the data — the
   * count is hidden entirely rather than fabricated.
   */
  const [planStats, setPlanStats] = useState<
    Record<number, { subscriber_count: number } | null>
  >({});
  const [maxCharges, setMaxCharges] = useState<Record<number, string>>({});
  const [depositBusy, setDepositBusy] = useState<number | null>(null);
  const [vaultBalances, setVaultBalances] = useState<Record<string, bigint>>({});
  const [direct, setDirect] = useState(false);
  const { run, getState, reset } = useAction();
  // Which plan is being signed for, and the hash once it lands: useAction
  // tracks that an action is running, not which plan or what it returned.
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // The key of the last subscribe attempt, kept after it finishes so its
  // failure is still readable once no plan is busy any more.
  const [lastKey, setLastKey] = useState<string | null>(null);
  const error = localError ?? (lastKey ? getState(lastKey).error : null);
  const setError = setLocalError;
  // The plan just subscribed to, so the confirmation can say when the trial it
  // advertised actually ends. The mandate id is not returned by `subscribe`, so
  // this is the only place the trial length is known at signing time.
  const [doneTrial, setDoneTrial] = useState<{ plan: string; seconds: number } | null>(null);
  // The subscription the subscriber has asked to confirm. Nothing is signed
  // until they press the dialog's confirm button; `at` is the wall clock the
  // summary was built from, so a trial end does not drift while the dialog is
  // up, and `address` is the account the permission was written for.
  const [pending, setPending] = useState<{
    plan: ApiPlan;
    limit: number;
    at: number;
    address: string;
  } | null>(null);
  const [feeBps, setFeeBps] = useState<number | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const feeReading = useRef(false);
  const { priceData: xlmPrice } = useXlmUsdPrice();

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const request = useRef(0);
  const walletState = useRef({ address, networkMismatch });
  // Mirrored in an effect: the wallet-changed guard is read from the signing
  // flow (event handler / async callback), never during render.
  useEffect(() => {
    walletState.current = { address, networkMismatch };
  }, [address, networkMismatch]);

  // Sync state if the URL changes externally. Keyed on the primitive values,
  // not the searchParams object: that object can be a fresh identity on every
  // render, which would reset a search the user is still typing.
  useEffect(() => {
    if (sortParam) setSort(sortParam);
    if (periodParam) setPeriod(periodParam);
    setQuery(queryParam);
    setTokenFilter(tokenParam);
  }, [sortParam, periodParam, queryParam, tokenParam]);

  /**
   * Apply one or more listing filters and mirror them in the URL, so a
   * filtered catalogue can be linked and survives a reload.
   */
  function updateParams(next: {
    sort?: PlanSortOption;
    period?: PlanPeriodOption;
    query?: string;
    token?: string;
  }) {
    const nextSort = next.sort ?? sort;
    const nextPeriod = next.period ?? period;
    const nextQuery = next.query ?? query;
    const nextToken = next.token ?? tokenFilter;
    setSort(nextSort);
    setPeriod(nextPeriod);
    setQuery(nextQuery);
    setTokenFilter(nextToken);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (nextSort && nextSort !== "newest") {
        url.searchParams.set("sort", nextSort);
      } else {
        url.searchParams.delete("sort");
      }
      if (nextPeriod && nextPeriod !== "all") {
        url.searchParams.set("period", nextPeriod);
      } else {
        url.searchParams.delete("period");
      }
      if (nextQuery.trim() !== "") {
        url.searchParams.set("q", nextQuery);
      } else {
        url.searchParams.delete("q");
      }
      if (nextToken && nextToken !== "all") {
        url.searchParams.set("token", nextToken);
      } else {
        url.searchParams.delete("token");
      }
      window.history.replaceState(null, "", url.toString());
    }
  }

  // Each plan can name a different token, so the cards read their own.
  const metas = useTokenMetas((plans ?? []).map((p) => p.token));

  const load = useCallback(async () => {
    const generation = ++request.current;
    const res = await api.plans();
    let loaded: ApiPlan[];
    let failed = false;
    try {
      loaded = res ? res.plans : await chainPlans(address ?? config.readSource);
    } catch {
      loaded = [];
      failed = true;
    }
    if (generation === request.current) {
      // Indexer rows carry future columns too; observe them so a newer
      // contract/backend is reported even when the contract fallback is idle.
      loaded.forEach((plan) => observeContractRecord("plan", plan));
      setPlans(loaded);
      setDirect(!res);
      setLoadFailed(failed);

      // Popularity signal: fetch each plan's subscriber count from the stats
      // API. Every call fails soft, so a backend that does not serve the
      // endpoint simply leaves the count hidden.
      if (loaded.length > 0) {
        void Promise.all(
          loaded.map(async (plan) => {
            // The backend fails soft and the stat source may be unable to
            // supply a count; treat anything but a real object as absent.
            const stats = await api.planStats(plan.id);
            if (generation === request.current) {
              setPlanStats((prev) => ({
                ...prev,
                [plan.id]:
                  stats !== null && stats !== undefined && typeof stats.subscriber_count === "number"
                    ? { subscriber_count: stats.subscriber_count }
                    : null,
              }));
            }
          }),
        );
      }
    }
    return loaded;
  }, [address]);

  useEffect(() => {
    void load();
    const started = request;
    return () => {
      started.current++;
    };
  }, [load]);

  useEffect(() => {
    if (!address || !plans) return;
    let active = true;
    const tokens = Array.from(new Set(plans.map((p) => p.token)));
    void (async () => {
      const map: Record<string, bigint> = {};
      for (const t of tokens) {
        try {
          const bal = await payflow.vaultBalance(address ?? config.readSource, address, t);
          if (active) map[t] = bal;
        } catch {
          // ignore
        }
      }
      if (active) setVaultBalances(map);
    })();
    return () => {
      active = false;
    };
  }, [address, plans]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Read the protocol fee once, lazily, when a confirmation is about to show it.
   *
   * A contract read, so it works the same with and without
   * `NEXT_PUBLIC_API_URL`. A failure is not fatal: the dialog says the fee could
   * not be read instead of showing 0% and implying the protocol charges nothing,
   * and the contract still takes its cut when the charge settles.
   */
  function loadFee() {
    if (feeReading.current || feeBps !== null) return;
    feeReading.current = true;
    setFeeLoading(true);
    void payflow
      .feeBps(address ?? config.readSource)
      .then((rate) => setFeeBps(rate))
      .catch(() => undefined)
      .finally(() => {
        feeReading.current = false;
        setFeeLoading(false);
      });
  }

  /**
   * Validate the cap and open the confirmation. Everything here is local: no
   * RPC, no wallet, so the dialog appears immediately. The availability check
   * uses the wall clock rather than the once-a-second render tick, because a
   * plan can close between the last render and this click — and confirming a
   * subscription the contract will refuse only costs the subscriber a fee.
   */
  function openConfirmation(plan: ApiPlan) {
    if (!address) {
      setError(tr("Connect a wallet first."));
      return;
    }
    if (networkMismatch) {
      setError(tr("Switch your wallet to the correct network first."));
      return;
    }
    const blocked = planAvailability(plan).reason;
    if (blocked) {
      setError(blocked);
      return;
    }
    const cap = checkChargeLimit(maxCharges[plan.id]);
    if (!cap.ok) {
      document.getElementById(`limit-${plan.id}`)?.focus();
      return;
    }
    setError(null);
    setPending({ plan, limit: cap.limit, at: Math.floor(Date.now() / 1000), address });
    loadFee();
  }

  function confirmSubscription() {
    if (!pending || !confirmation) return;
    const { plan, limit } = pending;
    // Close before signing: the wallet popup belongs on top of the page, not of
    // a modal, and closing hands focus back to the Subscribe button that opened
    // it. Progress and any error are then reported by the page itself.
    setPending(null);
    void subscribe(plan, limit);
  }

  async function depositFor(plan: ApiPlan, amount: bigint) {
    if (!address) {
      setError(tr("Connect a wallet first."));
      return;
    }
    if (networkMismatch) {
      setError(tr("Switch your wallet to the correct network first."));
      return;
    }
    if (amount <= 0n) {
      setError(tr("Enter a deposit amount first."));
      return;
    }
    setDepositBusy(plan.id);
    setError(null);
    try {
      const hash = await payflow.deposit(
        address,
        async (xdr, description) => {
          if (walletState.current.address !== address || walletState.current.networkMismatch) {
            throw new Error(tr("Wallet changed. Check your wallet and try again."));
          }
          return signXdr(xdr, description);
        },
        plan.token,
        amount,
      );
      setDone(hash);
      const bal = await payflow.vaultBalance(address ?? config.readSource, address, plan.token);
      setVaultBalances((m) => ({ ...m, [plan.token]: bal }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDepositBusy(null);
    }
  }

  async function subscribe(plan: ApiPlan, limit: number) {
    if (!address) {
      setError(tr("Connect a wallet first."));
      return;
    }
    if (networkMismatch) {
      setError(tr("Switch your wallet to the correct network first."));
      return;
    }
    const blocked = planAvailability(plan).reason;
    if (blocked) {
      setError(blocked);
      return;
    }
    setBusy(plan.id);
    setDone(null);
    setLocalError(null);
    reset(`subscribe-${plan.id}`);
    setLastKey(`subscribe-${plan.id}`);
    const hash = await run(`subscribe-${plan.id}`, async () => {
      const latest = (await load()).find((p) => p.id === plan.id);
      if (walletState.current.address !== address || walletState.current.networkMismatch) {
        throw new Error(tr("Wallet changed. Check your wallet and try again."));
      }
      if (!latest || latest.active !== 1) throw new Error(tr("This plan is no longer available."));
      const reason = planAvailability(latest).reason;
      if (reason) throw new Error(reason);
      const hash = await payflow.subscribe(
        address,
        async (xdr, description) => {
          if (walletState.current.address !== address || walletState.current.networkMismatch) {
            throw new Error(tr("Wallet changed. Check your wallet and try again."));
          }
          const closed = planAvailability(latest).reason;
          if (closed) throw new Error(closed);
          return signXdr(xdr, description);
        },
        plan.id,
        limit,
      );
      setDoneTrial(
        trialSeconds(plan) > 0
          ? { plan: plan.name || `Plan #${plan.id}`, seconds: trialSeconds(plan) }
          : null,
      );
      await load();
      return hash;
    });
    setBusy(null);
    if (hash) setDone(hash);
  }

  const active = useMemo(() => (plans ?? []).filter((p) => p.active === 1), [plans]);
  // A link to a plan that has been deactivated or removed is not an empty
  // page: `sharedPlan` stays null and the page says the plan is gone.
  const sharedPlan = useMemo(
    () => (shared.kind === "plan" ? active.find((p) => p.id === shared.id) ?? null : null),
    [active, shared],
  );
  const sharedMissing = shared.kind === "plan" && plans !== null && sharedPlan === null;
  const filteredPlans = useMemo(() => {
    // A link that names a plan shows that plan and nothing else: falling back
    // to the catalogue would quietly offer a different plan from the one the
    // link promised.
    if (shared.kind === "plan") return sharedPlan ? [sharedPlan] : [];
    return filterAndSortPlans(active, {
      sort,
      period,
      query,
      token: tokenFilter,
    });
  }, [active, sort, period, query, tokenFilter, shared, sharedPlan]);
  /** Tokens present in the catalogue, keeping the URL-selected one visible. */
  const tokenOptions = useMemo(() => {
    const ids = [...new Set(active.map((plan) => plan.token))];
    if (tokenFilter !== "all" && !ids.includes(tokenFilter)) ids.push(tokenFilter);
    return ids;
  }, [active, tokenFilter]);
  // Compare from the full active list rather than the filtered one: changing
  // the filter must not silently drop a column the subscriber already picked.
  const comparedPlans = useMemo(
    () => plansForComparison(active, compareIds),
    [active, compareIds],
  );

  function toggleCompare(planId: number) {
    const next = togglePlanComparison(compareIds, planId);
    setCompareIds(next);
    // A one-plan table is not a comparison; close it rather than leaving a
    // stale table on screen when the second plan is unticked.
    if (next.length < 2) setShowComparison(false);
  }

  function clearComparison() {
    setCompareIds([]);
    setShowComparison(false);
  }

  // A refresh can deactivate one of the selected plans; a table with one
  // column is not a comparison, so close it rather than leave it half full.
  useEffect(() => {
    if (comparedPlans.length < 2) setShowComparison(false);
  }, [comparedPlans.length]);

  /**
   * A confirmation authorises charges for one account, so it only exists while
   * that account is the connected one, on the right network. Derived rather
   * than cleared in an effect: if the wallet disconnects or switches accounts
   * mid-load, the dialog closes itself instead of asking for a commitment the
   * new account never saw.
   */
  const confirmation =
    pending && address && !networkMismatch && pending.address === address
      ? confirmationFor({
          plan: pending.plan,
          limit: pending.limit,
          feeBps,
          now: pending.at,
        })
      : null;
  const pendingPlan = confirmation && pending ? pending.plan : null;
  const pendingName = pendingPlan
    ? pendingPlan.name || tr("Plan #{0}", { "0": pendingPlan.id })
    : "";
  const pendingMeta = pendingPlan ? metaFor(metas, pendingPlan.token) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {sharedPlan ? sharedPlan.name || tr("Available plans") : tr("Available plans")}
        </h1>
        <p className="mt-1 text-sm text-muted">{tr("Subscribing opens a mandate. Fund your vault on the")}{" "}
          <Link href="/account" className="text-accent hover:underline">{tr("account page")}</Link>{" "}{tr("or charges will fail for lack of balance.")}</p>
        {shared.kind === "plan" && (
          <p className="mt-2 text-sm">
            <Link href="/subscribe/" className="text-accent hover:underline">
              {tr("See all plans")}
            </Link>
          </p>
        )}
      </div>

      <SubscriberGuide />

      {sharedMissing && (
        <Notice tone="info">
          {tr("That plan is no longer listed. The merchant may have deactivated it.")}
        </Notice>
      )}
      {shared.kind === "invalid" && (
        <Notice tone="info">
          {tr("That link does not name a plan, so every plan is listed below.")}
        </Notice>
      )}
      {direct && (
        <Notice tone="info">{tr("Reading plans directly from the contract — the indexer is not reachable, so this list is capped at the first 24 plans.")}</Notice>
      )}
      <ContractVersionNotice />
      {/* Announced as soon as it appears: a keyboard or screen-reader user
          should not have to hunt for the reason a subscribe attempt failed. */}
      {error && <Notice tone="error" role="alert">{translateMessage(error)}</Notice>}
      {done && (
        <Notice tone="ok" role="status">{tr("Subscribed. Transaction")}{" "}<TxLink hash={done} />
          {doneTrial && (
            <>
              {" "}
              {doneTrial.plan}{" "}{tr("has a")}{" "}{formatTrialLength(doneTrial.seconds)}{" "}{tr("free trial, so your first charge is due")}{" "}{formatTrialLength(doneTrial.seconds)}{" "}{tr("from now — nothing is taken before then, and cancelling before then costs nothing.")}</>
          )}
        </Notice>
      )}

      {plans === null ? (
        <SkeletonPlanCards label={tr("Loading plans")} />
      ) : loadFailed ? (
        <Empty
          title={tr("Could not load plans")}
          action={
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setPlans(null);
                void load();
              }}
            >{tr("Retry")}</button>
          }
        >{tr("Neither the plan indexer nor the contract could be read. Check your connection and try again.")}</Empty>
      ) : active.length === 0 ? (
        (plans ?? []).length === 0 ? (
          <Empty
            title={tr("No plans yet")}
            action={
              <Link href="/merchant" className="btn-primary">{tr("Publish a plan")}</Link>
            }
          >{tr("Nothing has been published on this deployment yet. Publish a plan from the merchant page — it is written straight to the contract, so it appears here with or without the indexer.")}</Empty>
        ) : (
          <Empty
            title={tr("No active plans right now")}
            action={
              <Link href="/merchant" className="btn-primary">{tr("Publish a plan")}</Link>
            }
          >{tr("Every plan on this list is deactivated, so there is nothing to subscribe to at the moment. Check back later, or publish your own plan from the merchant page.")}</Empty>
        )
      ) : (
        <div className="space-y-4">
          {/* Search, filter and sort toolbar */}
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-edge bg-surface/50 p-3">
            <div className="w-full sm:w-auto sm:min-w-[14rem] sm:flex-1">
              <Search
                id="plan-search"
                value={query}
                onChange={(value) => updateParams({ query: value })}
                label={tr("Search plans by name")}
                placeholder={tr("Search by name")}
              />
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="token-filter" className="whitespace-nowrap text-sm font-medium text-muted">{tr("Token:")}</label>
              <select
                id="token-filter"
                className="input py-1 px-2.5 text-sm"
                value={tokenFilter}
                onChange={(e) => updateParams({ token: e.target.value })}
              >
                <option value="all">{tr("All tokens")}</option>
                {tokenOptions.map((id) => (
                  <option key={id} value={id}>
                    {metaFor(metas, id).symbol}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="period-filter" className="whitespace-nowrap text-sm font-medium text-muted">{tr("Billing period:")}</label>
              <select
                id="period-filter"
                className="input py-1 px-2.5 text-sm"
                value={period}
                onChange={(e) => updateParams({ period: e.target.value as PlanPeriodOption })}
              >
                <option value="all">{tr("All periods")}</option>
                <option value="daily">{tr("Daily")}</option>
                <option value="weekly">{tr("Weekly")}</option>
                <option value="monthly">{tr("Monthly")}</option>
                <option value="yearly">{tr("Annual")}</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="sort-select" className="whitespace-nowrap text-sm font-medium text-muted">{tr("Sort by:")}</label>
              <select
                id="sort-select"
                className="input py-1 px-2.5 text-sm"
                value={sort}
                onChange={(e) => updateParams({ sort: e.target.value as PlanSortOption })}
              >
                <option value="newest">{tr("Newest first")}</option>
                <option value="price_asc">{tr("Price: Low to High")}</option>
                <option value="price_desc">{tr("Price: High to Low")}</option>
                <option value="period_asc">{tr("Period: Short to Long")}</option>
                <option value="period_desc">{tr("Period: Long to Short")}</option>
                <option value="popularity_desc">{tr("Popularity: Most subscribers")}</option>
                <option value="popularity_asc">{tr("Popularity: Fewest subscribers")}</option>
              </select>
            </div>

            <span className="ms-auto text-xs text-muted" aria-live="polite">{tr("Showing")}{" "}{formatNumber(filteredPlans.length)}{" "}{tr("of")}{" "}{formatNumber(active.length)}{" "}{tr("plans")}</span>
          </div>

          {compareIds.length > 0 && (
            <section
              className="rounded-lg border border-edge bg-surface/50 p-3"
              aria-label={tr("Plan comparison")}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted" role="status">
                  {formatNumber(compareIds.length)}{" "}{tr("of")}{" "}{COMPARE_LIMIT}{" "}{tr("plans selected for comparison")}{compareIds.length === COMPARE_LIMIT ?tr(" (maximum)") : ""}.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={comparedPlans.length < 2}
                    aria-expanded={showComparison}
                    aria-controls="plan-comparison"
                    onClick={() => setShowComparison((open) => !open)}
                  >
                    {showComparison ?tr("Hide comparison") :tr("Compare plans")}
                  </button>
                  <button type="button" className="btn-ghost" onClick={clearComparison}>{tr("Clear selection")}</button>
                </div>
              </div>
              {comparedPlans.length < 2 && (
                <p className="mt-2 text-xs text-muted">{tr("Select at least two plans to compare them side by side.")}</p>
              )}
              {showComparison && comparedPlans.length >= 2 && (
                <div id="plan-comparison">
                  <ComparisonTable plans={comparedPlans} metas={metas} now={now} />
                </div>
              )}
            </section>
          )}

          {filteredPlans.length === 0 ? (
            <Empty
              title={tr("No plans match this filter")}
              action={
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() =>
                    updateParams({ sort: "newest", period: "all", query: "", token: "all" })
                  }
                >{tr("Reset filters")}</button>
              }
            >{tr("No active subscription plans match your search, token and billing period. Clear the filters to see them all.")}</Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {filteredPlans.map((plan) => {

                const meta = metaFor(metas, plan.token);
                const badge = trialBadge(plan);
                const availability = planAvailability(plan, now);
                const usdEstimate =
                  meta.symbol === "XLM" && xlmPrice
                    ? formatUsdString(formatUsdEstimate(plan.amount, xlmPrice.price, xlmPrice.decimals, meta.decimals))
                    : meta.symbol === "USDC"
                      ? formatUsdString(formatUsdcEstimate(plan.amount, meta.decimals))
                      : null;
                const selectedForCompare = compareIds.includes(plan.id);
                const stats = planStats[plan.id];
                const statsLoading = !(plan.id in planStats);
                return (
                  <Panel
                    key={plan.id}
                    title={plan.name ||tr("Plan #{0}", { "0": plan.id })}
                    onMouseEnter={() => prefetchPlan(plan.id)}
                    onFocusCapture={() => prefetchPlan(plan.id)}
                    actions={
                      <label htmlFor={`compare-plan-${plan.id}`} className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm text-muted">
                        <input
                          id={`compare-plan-${plan.id}`}
                          type="checkbox"
                          className="h-4 w-4 accent-accent"
                          checked={selectedForCompare}
                          disabled={!selectedForCompare && compareIds.length >= COMPARE_LIMIT}
                          onChange={() => toggleCompare(plan.id)}
                          aria-label={tr("Compare {0}", { "0": plan.name ||tr("Plan #{0}", { "0": plan.id }) })}
                        />{tr("Compare")}</label>
                    }
                  >
                    <div className="space-y-3">
                      <div>
                        <div className="flex flex-wrap items-baseline gap-2">
                          <div className="text-2xl font-semibold tabular-nums">
                            {formatTokenValue(plan.amount, 4, meta.decimals)}{" "}
                            <span className="text-sm font-normal text-muted">{meta.symbol}</span>
                          </div>
                          {usdEstimate && (
                            <span
                              className="text-sm text-muted tabular-nums"
                              title={tr("Estimated USD value based on Reflector oracle price")}
                              aria-label={tr("Approximately {0} US Dollars", { "0": usdEstimate })}
                            >
                              (≈ {usdEstimate})
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                          <span>{formatPeriod(plan.period)}</span>
                          {badge && (
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                              {badge}
                            </span>
                          )}
                        </div>
                        {badge && (
                          <p className="mt-1 text-xs text-muted">{tr("Nothing is charged for")}{" "}{formatTrialLength(trialSeconds(plan))}{tr(". You can cancel any time before the first charge and pay nothing.")}</p>
                        )}
                        {/* Per-plan subscriber count from the stats API. While the
                            fetch is in flight nothing is shown (never a
                            misleading zero); when no source can supply it the
                            block is hidden entirely. */}
                        {statsLoading ? (
                          <div
                            className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted"
                            aria-busy="true"
                            role="status"
                          >
                            <span className="sr-only">{tr("Loading subscribers")}</span>
                            <span className="h-3 w-12 rounded bg-fg/10 motion-safe:animate-pulse" aria-hidden="true" />
                          </div>
                        ) : stats ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                            <span className="text-muted">{tr("Subscribers")}</span>
                            <span className="font-medium tabular-nums">
                              {formatNumber(stats.subscriber_count)}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      {availability.until !== null && (
                        <p className="text-sm text-muted">{tr("Available until")}{" "}
                          <TimeAgo value={availability.until} now={now * 1000} />
                        </p>
                      )}
                      {availability.seats !== null && (
                        <p className="text-sm text-accent">
                          {formatNumber(availability.seats)} {availability.seats === 1 ?tr("seat") :tr("seats")}{" "}{tr("left")}</p>
                      )}
                      {availability.countUnavailable && (
                        <p className="text-sm text-muted">{tr("Remaining seats are unavailable from this source. Availability is checked by the contract when subscribing.")}</p>
                      )}
                      {availability.reason && (
                        <p id={`availability-${plan.id}`} className="text-sm text-muted">
                          {translateMessage(availability.reason ?? "")}
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-muted">{tr("Merchant")}</span>
                        <MerchantAccount value={plan.merchant} />
                      </div>

                      <div>
                        <label className="label" htmlFor={`limit-${plan.id}`}>{tr("Charge limit (0 = open-ended)")}</label>
                        <input
                          id={`limit-${plan.id}`}
                          className="input"
                          inputMode="numeric"
                          placeholder="0"
                          value={maxCharges[plan.id] ?? ""}
                          onChange={(e) =>
                            setMaxCharges((m) => ({ ...m, [plan.id]: e.target.value }))
                          }
                          aria-invalid={!cap.ok || undefined}
                          aria-describedby={!cap.ok ? `limit-error-${plan.id}` : undefined}
                          onKeyDown={(e) => {
                            // Enter submits the card's small form from its only
                            // text field. Without it a keyboard user has to tab
                            // through the vault controls to reach Subscribe.
                            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                            e.preventDefault();
                            if (busy === null) openConfirmation(plan);
                          }}
                        />
                        {!cap.ok && (
                          <p id={`limit-error-${plan.id}`} role="alert" className="mt-1 text-sm text-danger">
                            {translateMessage(cap.message)}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                            <div className="rounded-lg border border-edge bg-surface/40 p-2 text-xs space-y-1">
                              <div className="flex items-center justify-between font-medium">
                                <span className="text-muted">{tr("Guided Flow")}</span>
                                <span className={funded ? "text-accent font-semibold" : "text-warn font-semibold"}>
                                  {funded ? tr("Step 2: Ready to Subscribe") : tr("Step 1: Fund Vault First")}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-muted">
                                <span>{tr("Vault balance")}</span>
                                <span className="tabular-nums font-medium text-fg">{formatTokenValue(currentBal, 4, meta.decimals)} {meta.symbol}</span>
                              </div>
                            </div>

                            {!funded && (
                              <DepositCoverageInput
                                planAmount={plan.amount}
                                decimals={meta.decimals}
                                symbol={meta.symbol}
                                busy={depositBusy === plan.id}
                                disabled={depositBusy !== null || !address || networkMismatch}
                                onDeposit={(amount) => depositFor(plan, amount)}
                              />
                            )}

                            <LoadingButton
                              variant="primary"
                              className="w-full"
                              loading={busy === plan.id}
                              loadingText={tr("Confirming…")}
                              disabled={
                                busy !== null || !address || networkMismatch || availability.reason !== null
                              }
                              aria-describedby={availability.reason ? `availability-${plan.id}` : undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                openConfirmation(plan);
                              }}
                            >
                              {networkMismatch
                                ?tr("Wrong network")
                                : address
                                  ? busy === plan.id && signing
                                    ? tr("Signing…")
                                    : tr("Subscribe")
                                  : tr("Connect wallet")}
                            </LoadingButton>
                          </div>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/*
        What the subscriber is agreeing to, before any signature is requested.

        A better approach than a dialog was considered and rejected: expanding
        the card in place would sit in a two-column grid at 375px, and the
        wallet popup would still appear over a card the reader may have scrolled
        away from. `Dialog` already traps focus, closes on Escape and returns
        focus to this card's Subscribe button, so this is a stated commitment
        rather than another inline paragraph.
      */}
      <ConfirmDialog
        open={confirmation !== null}
        onCancel={() => setPending(null)}
        onConfirm={confirmSubscription}
        title={confirmation ? tr("Subscribe to {0}?", { "0": pendingName }) : ""}
        confirmLabel={tr("Confirm and sign")}
      >
        {confirmation && pendingPlan && pendingMeta && (
          <>
            <p className="text-muted">
              {tr("A mandate is a standing permission, not a one-off payment. The merchant can charge the amount below from your vault each billing period until you cancel it or it reaches the charge limit.")}
            </p>
            <dl className="mt-4 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <dt className="text-muted">{tr("Amount")}</dt>
                <dd className="font-medium tabular-nums">
                  {formatAmount(confirmation.gross, pendingMeta)}
                </dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <dt className="text-muted">{tr("Billing period")}</dt>
                <dd>{formatPeriod(confirmation.periodSeconds)}</dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <dt className="text-muted">{tr("Protocol fee")}</dt>
                <dd className="tabular-nums">
                  {confirmation.fee === null || confirmation.feeBps === null
                    ? feeLoading
                      ? tr("Checking…")
                      : tr("Unavailable")
                    : `${formatAmount(confirmation.fee, pendingMeta)} (${formatFeeBps(confirmation.feeBps)})`}
                </dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <dt className="text-muted">{tr("Charge limit")}</dt>
                <dd>
                  {confirmation.openEnded
                    ? tr("No limit — charges continue until you cancel.")
                    : confirmation.limit === 1
                      ? tr("1 charge, then the mandate completes.")
                      : tr("{0} charges, then the mandate completes.", { "0": confirmation.limit })}
                </dd>
              </div>
              {confirmation.totalCommitment !== null && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <dt className="text-muted">{tr("Total authorised")}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatAmount(confirmation.totalCommitment, pendingMeta)}
                  </dd>
                </div>
              )}
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <dt className="text-muted">{tr("First charge")}</dt>
                <dd>
                  {confirmation.firstChargeDueNow
                    ? tr("Due now")
                    : `${formatDate(confirmation.firstChargeAt)} (${formatWhen(confirmation.firstChargeAt)})`}
                </dd>
              </div>
              {confirmation.lastChargeAt !== null && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <dt className="text-muted">{tr("Final charge")}</dt>
                  <dd>
                    <time dateTime={new Date(confirmation.lastChargeAt * 1000).toISOString()}>
                      {formatDate(confirmation.lastChargeAt)} ({formatWhen(confirmation.lastChargeAt)})
                    </time>
                  </dd>
                </div>
              )}
            </dl>
            {!confirmation.openEnded && confirmation.lastChargeAt !== null && confirmation.totalCommitment !== null && (
              <p className="mt-4 rounded-lg border border-edge/80 bg-fg/[0.02] p-3 text-sm text-muted">
                {confirmation.limit === 1
                  ? tr("This cap ends the mandate automatically: its only charge is due {0} ({1}). Once that charge settles, no further charges are taken and the mandate completes — there is nothing left to cancel.", { "0": formatDate(confirmation.lastChargeAt), "1": formatWhen(confirmation.lastChargeAt) })
                  : tr("This cap ends the mandate automatically: the final charge is number {0} of the {1} authorised in total, due {2} ({3}). After it settles, no further charges are taken and the mandate completes. Cancel from your account page before then to stop it sooner.", { "0": confirmation.limit, "1": formatAmount(confirmation.totalCommitment, pendingMeta), "2": formatDate(confirmation.lastChargeAt), "3": formatWhen(confirmation.lastChargeAt) })}
              </p>
            )}
            {confirmation.fee === null && !feeLoading && (
              <p className="mt-3 text-xs text-muted">
                {tr("The protocol fee could not be read from the contract right now. It is still taken from the amount above when the charge settles.")}
              </p>
            )}
            <p className="mt-4 text-muted">
              {tr("Cancel any time from your account page — no fee, and cancelling stops the next charge.")}
            </p>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

export default function SubscribePage() {
  const { t: tr } = useI18n();
  return (
    <Suspense fallback={<SkeletonPlanCards label={tr("Loading plans")} />}>
      <SubscribeInner />
    </Suspense>
  );
}