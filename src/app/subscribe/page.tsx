"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, type ApiPlan } from "@/lib/api";
import { chainPlans } from "@/lib/chain";
import { config } from "@/lib/config";
import { payflow } from "@/lib/payflow";
import { useWallet } from "@/lib/wallet";
import { formatDate, formatWhen, formatPeriod, fromStroops } from "@/lib/format";
import { formatTrialLength, trialBadge, trialSeconds } from "@/lib/trial";
import { planAvailability } from "@/lib/availability";
import { metaFor, useTokenMetas } from "@/lib/token";
import { Empty, MerchantAccount, Notice, Panel, SkeletonPlanCards, TxLink } from "@/components/ui";

export default function SubscribePage() {
  const { address, networkMismatch, signXdr } = useWallet();
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [maxCharges, setMaxCharges] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [direct, setDirect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The plan just subscribed to, so the confirmation can say when the trial it
  // advertised actually ends. The mandate id is not returned by `subscribe`, so
  // this is the only place the trial length is known at signing time.
  const [doneTrial, setDoneTrial] = useState<{ plan: string; seconds: number } | null>(null);

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const request = useRef(0);
  const walletState = useRef({ address, networkMismatch });
  walletState.current = { address, networkMismatch };

  // Each plan can name a different token, so the cards read their own.
  const metas = useTokenMetas((plans ?? []).map((p) => p.token));

  const load = useCallback(async () => {
    const generation = ++request.current;
    const res = await api.plans();
    let loaded: ApiPlan[];
    try {
      loaded = res ? res.plans : await chainPlans(address ?? config.readSource);
    } catch {
      loaded = [];
    }
    if (generation === request.current) {
      setPlans(loaded);
      setDirect(!res);
    }
    return loaded;
  }, [address]);

  useEffect(() => {
    void load();
    const pending = request;
    return () => { pending.current++; };
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  async function subscribe(plan: ApiPlan) {
    if (!address) {
      setError("Connect a wallet first.");
      return;
    }
    if (networkMismatch) {
      setError("Switch your wallet to the correct network first.");
      return;
    }
    const blocked = planAvailability(plan).reason;
    if (blocked) {
      setError(blocked);
      return;
    }
    setBusy(plan.id);
    setError(null);
    setDone(null);
    try {
      const raw = maxCharges[plan.id]?.trim();
      const limit = raw ? Number(raw) : 0;
      if (!Number.isInteger(limit) || limit < 0) {
        throw new Error("Charge limit must be a whole number, or 0 for open-ended.");
      }
      // Re-read before signing: another subscriber may have taken the last seat.
      // The contract remains authoritative for races after this read.
      const latest = (await load()).find((p) => p.id === plan.id);
      if (walletState.current.address !== address || walletState.current.networkMismatch) {
        throw new Error("Wallet changed. Check your wallet and try again.");
      }
      if (!latest || latest.active !== 1) throw new Error("This plan is no longer available.");
      const reason = planAvailability(latest).reason;
      if (reason) throw new Error(reason);
      const hash = await payflow.subscribe(address, async (xdr) => {
        if (walletState.current.address !== address || walletState.current.networkMismatch) {
          throw new Error("Wallet changed. Check your wallet and try again.");
        }
        const closed = planAvailability(latest).reason;
        if (closed) throw new Error(closed);
        return signXdr(xdr);
      }, plan.id, limit);
      setDone(hash);
      setDoneTrial(
        trialSeconds(plan) > 0
          ? { plan: plan.name || `Plan #${plan.id}`, seconds: trialSeconds(plan) }
          : null,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const active = (plans ?? []).filter((p) => p.active === 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Available plans</h1>
        <p className="mt-1 text-sm text-muted">
          Subscribing opens a mandate. Fund your vault on the{" "}
          <Link href="/account" className="text-accent hover:underline">
            account page
          </Link>{" "}
          or charges will fail for lack of balance.
        </p>
      </div>

      {direct && (
        <Notice tone="info">
          Reading plans directly from the contract — the indexer is not
          reachable, so this list is capped at the first 24 plans.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {done && (
        <Notice tone="ok">
          Subscribed. Transaction <TxLink hash={done} />
          {doneTrial && (
            <>
              {" "}
              {doneTrial.plan} has a {formatTrialLength(doneTrial.seconds)} free trial, so your
              first charge is due {formatTrialLength(doneTrial.seconds)} from now — nothing is
              taken before then, and cancelling before then costs nothing.
            </>
          )}
        </Notice>
      )}

      {plans === null ? (
        <SkeletonPlanCards label="Loading plans" />
      ) : active.length === 0 ? (
        (plans ?? []).length === 0 ? (
          <Empty
            title="No plans yet"
            action={
              <Link href="/merchant" className="btn-primary">
                Publish a plan
              </Link>
            }
          >
            Nothing has been published on this deployment yet. Publish a plan
            from the merchant page — it is written straight to the contract, so
            it appears here with or without the indexer.
          </Empty>
        ) : (
          <Empty
            title="No active plans right now"
            action={
              <Link href="/merchant" className="btn-primary">
                Publish a plan
              </Link>
            }
          >
            Every plan on this list is deactivated, so there is nothing to
            subscribe to at the moment. Check back later, or publish your own
            plan from the merchant page.
          </Empty>
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {active.map((plan) => {
            const meta = metaFor(metas, plan.token);
            const badge = trialBadge(plan);
            const availability = planAvailability(plan, now);
            return (
            <Panel key={plan.id} title={plan.name || `Plan #${plan.id}`}>
              <div className="space-y-3">
                <div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {fromStroops(plan.amount, 4, meta.decimals)}{" "}
                    <span className="text-sm font-normal text-muted">{meta.symbol}</span>
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
                    <p className="mt-1 text-xs text-muted">
                      Nothing is charged for {formatTrialLength(trialSeconds(plan))}. You can
                      cancel any time before the first charge and pay nothing.
                    </p>
                  )}
                </div>

                {availability.until !== null && (
                  <p className="text-sm text-muted">
                    Available until <time dateTime={new Date(availability.until * 1000).toISOString()}>
                      {formatDate(availability.until)} ({formatWhen(availability.until, now * 1000)})
                    </time>
                  </p>
                )}
                {availability.seats !== null && (
                  <p className="text-sm text-accent">{availability.seats} {availability.seats === 1 ? "seat" : "seats"} left</p>
                )}
                {availability.countUnavailable && (
                  <p className="text-sm text-muted">Remaining seats are unavailable from this source. Availability is checked by the contract when subscribing.</p>
                )}
                {availability.reason && (
                  <p id={`availability-${plan.id}`} className="text-sm text-muted">{availability.reason}</p>
                )}

                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted">Merchant</span>
                  <MerchantAccount value={plan.merchant} />
                </div>

                <div>
                  <label className="label" htmlFor={`limit-${plan.id}`}>
                    Charge limit (0 = open-ended)
                  </label>
                  <input
                    id={`limit-${plan.id}`}
                    className="input"
                    inputMode="numeric"
                    placeholder="0"
                    value={maxCharges[plan.id] ?? ""}
                    onChange={(e) =>
                      setMaxCharges((m) => ({ ...m, [plan.id]: e.target.value }))
                    }
                  />
                </div>

                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={busy !== null || !address || networkMismatch || availability.reason !== null}
                  aria-describedby={availability.reason ? `availability-${plan.id}` : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    void subscribe(plan);
                  }}
                >
                  {busy === plan.id ? "Confirming…" : networkMismatch ? "Wrong network" : address ? "Subscribe" : "Connect wallet"}
                </button>
              </div>
            </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
