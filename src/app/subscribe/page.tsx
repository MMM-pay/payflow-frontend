"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type ApiPlan } from "@/lib/api";
import { chainPlans } from "@/lib/chain";
import { config } from "@/lib/config";
import { payflow } from "@/lib/payflow";
import { useWallet } from "@/lib/wallet";
import { formatPeriod, fromStroops } from "@/lib/format";
import { metaFor, useTokenMetas } from "@/lib/token";
import { AddressLink, Empty, Notice, Panel, SkeletonPlanCards, TxLink } from "@/components/ui";

export default function SubscribePage() {
  const { address, networkMismatch, signXdr } = useWallet();
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [maxCharges, setMaxCharges] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [direct, setDirect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Each plan can name a different token, so the cards read their own.
  const metas = useTokenMetas((plans ?? []).map((p) => p.token));

  const load = useCallback(async () => {
    const res = await api.plans();
    if (res) {
      setPlans(res.plans);
      setDirect(false);
      return;
    }
    // No indexer: enumerate straight from the registry.
    try {
      setPlans(await chainPlans(address ?? config.readSource));
      setDirect(true);
    } catch {
      setPlans([]);
      setDirect(true);
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  async function subscribe(plan: ApiPlan) {
    if (!address) {
      setError("Connect a wallet first.");
      return;
    }
    if (networkMismatch) {
      setError("Switch your wallet to the correct network first.");
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
      const hash = await payflow.subscribe(address, signXdr, plan.id, limit);
      setDone(hash);
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
        </Notice>
      )}

      {plans === null ? (
        <SkeletonPlanCards label="Loading plans" />
      ) : active.length === 0 ? (
        <Empty>
          No active plans yet. Publish one from the merchant page to see it here.
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {active.map((plan) => {
            const meta = metaFor(metas, plan.token);
            return (
            <Panel key={plan.id} title={plan.name || `Plan #${plan.id}`}>
              <div className="space-y-3">
                <div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {fromStroops(plan.amount, 4, meta.decimals)}{" "}
                    <span className="text-sm font-normal text-muted">{meta.symbol}</span>
                  </div>
                  <div className="text-sm text-muted">{formatPeriod(plan.period)}</div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Merchant</span>
                  <AddressLink value={plan.merchant} />
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
                  disabled={busy === plan.id || !address || networkMismatch}
                  onClick={() => void subscribe(plan)}
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
