"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ApiMandate, type ApiPlan, type MerchantSummary } from "@/lib/api";
import { chainMandatesFor, chainMerchantSummary, chainPlansOf } from "@/lib/chain";
import { config } from "@/lib/config";
import { payflow } from "@/lib/payflow";
import { useWallet } from "@/lib/wallet";
import { formatPeriod, formatWhen, fromStroops, toStroops } from "@/lib/format";
import { AddressLink, Badge, Empty, Notice, Panel, Stat, TxLink } from "@/components/ui";

const PERIOD_OPTIONS = [
  { label: "Every minute (demo)", value: 60 },
  { label: "Daily", value: 86_400 },
  { label: "Weekly", value: 604_800 },
  { label: "Monthly", value: 2_592_000 },
  { label: "Yearly", value: 31_536_000 },
];

export default function MerchantPage() {
  const { address, networkMismatch, signXdr } = useWallet();
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [mandates, setMandates] = useState<ApiMandate[] | null>(null);
  const [summary, setSummary] = useState<MerchantSummary | null>(null);

  const [price, setPrice] = useState("");
  const [period, setPeriod] = useState(2_592_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    const [p, m, s] = await Promise.all([
      api.plans(address),
      api.mandatesFor(address),
      api.merchantSummary(address),
    ]);
    if (p) {
      setPlans(p.plans);
    } else {
      try {
        setPlans(await chainPlansOf(address, address));
      } catch {
        setPlans([]);
      }
    }

    let rows: ApiMandate[] = [];
    if (m) {
      rows = m.mandates;
    } else {
      try {
        rows = await chainMandatesFor(address, address);
      } catch {
        rows = [];
      }
    }
    setMandates(rows);

    // Revenue totals come from charge history, which only the indexer has.
    setSummary(s ?? chainMerchantSummary(address, rows));
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      setDone(await fn());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (!address) {
    return (
      <Panel title="Merchant dashboard">
        <Empty>Connect a wallet to publish plans and track revenue.</Empty>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Collected"
          value={summary?.totalCollected ? `${fromStroops(summary.totalCollected)}` : "—"}
          hint="XLM, net of protocol fee"
        />
        <Stat label="Active mandates" value={summary?.activeMandates ?? "…"} />
        <Stat label="Charges settled" value={summary?.chargeCount ?? "…"} />
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {done && (
        <Notice tone="ok">
          Done. Transaction <TxLink hash={done} />
        </Notice>
      )}

      <Panel
        title="Publish a plan"
        subtitle="Price and period are frozen into every mandate opened against this plan. To change them, publish a new plan."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[10rem] flex-1">
            <label className="label" htmlFor="price">
              Price (XLM)
            </label>
            <input
              id="price"
              className="input"
              inputMode="decimal"
              placeholder="1.0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="min-w-[10rem] flex-1">
            <label className="label" htmlFor="period">
              Billing period
            </label>
            <select
              id="period"
              className="input"
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
            >
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null || networkMismatch}
            onClick={() =>
              void run("create", () =>
                payflow.createPlan(address, signXdr, {
                  token: config.contracts.token,
                  amount: toStroops(price),
                  period,
                }),
              )
            }
          >
            {busy === "create" ? "Publishing…" : "Publish plan"}
          </button>
        </div>
      </Panel>

      <Panel title="My plans">
        {plans === null ? (
          <Empty>Loading…</Empty>
        ) : plans.length === 0 ? (
          <Empty>No plans yet.</Empty>
        ) : (
          <div className="space-y-3">
            {plans.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Plan #{p.id}</span>
                    <Badge status={p.active ? "Active" : "Paused"} />
                  </div>
                  <div className="mt-1 text-sm text-muted">
                    {fromStroops(p.amount)} XLM {formatPeriod(p.period)}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy !== null || networkMismatch}
                  onClick={() =>
                    void run(`toggle-${p.id}`, () =>
                      payflow.setPlanActive(address, signXdr, p.id, p.active !== 1),
                    )
                  }
                >
                  {p.active ? "Deactivate" : "Activate"}
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Subscribers"
        subtitle="Charging is permissionless — you can settle a due mandate yourself instead of waiting for the keeper."
      >
        {mandates === null ? (
          <Empty>Loading…</Empty>
        ) : mandates.length === 0 ? (
          <Empty>No subscribers yet.</Empty>
        ) : (
          <div className="space-y-3">
            {mandates.map((m) => {
              const due = m.status === "Active" && m.next_charge * 1000 <= Date.now();
              return (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge p-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">#{m.id}</span>
                      <AddressLink value={m.subscriber} />
                      <Badge status={m.status} />
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {fromStroops(m.amount)} XLM {formatPeriod(m.period)} ·{" "}
                      {m.charges_made} settled · next{" "}
                      {m.status === "Active" ? formatWhen(m.next_charge) : "—"}
                    </div>
                  </div>
                  {due && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy !== null || networkMismatch}
                      onClick={() =>
                        void run(`charge-${m.id}`, () =>
                          payflow.charge(address, signXdr, m.id),
                        )
                      }
                    >
                      {busy === `charge-${m.id}` ? "Charging…" : "Charge now"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
