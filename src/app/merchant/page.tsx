"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ApiMandate, type ApiPlan, type MerchantSummary } from "@/lib/api";
import { chainMandatesFor, chainMerchantSummary, chainPlansOf, endable } from "@/lib/chain";
import { config } from "@/lib/config";
import { MAX_NAME_LEN, nameByteLength, payflow } from "@/lib/payflow";
import { useWallet } from "@/lib/wallet";
import {
  checkAmount,
  feeSplit,
  formatAmount,
  formatFeeBps,
  formatPeriod,
  formatWhen,
  fromStroops,
  type FeeSplit,
  type TokenMeta,
} from "@/lib/format";
import { metaFor, useTokenMetas } from "@/lib/token";
import { supportsTrials, trialBadge, TRIAL_OPTIONS } from "@/lib/trial";
import { AddressLink, Badge, Empty, Notice, Panel, SkeletonRows, Stat, TxLink } from "@/components/ui";

const PERIOD_OPTIONS = [
  { label: "Every minute (demo)", value: 60 },
  { label: "Daily", value: 86_400 },
  { label: "Weekly", value: 604_800 },
  { label: "Monthly", value: 2_592_000 },
  { label: "Yearly", value: 31_536_000 },
];

/**
 * "subscriber pays X, you receive Y after the Z% fee".
 *
 * All three figures come from one bigint split in the token's own scale, so
 * the net shown here is exactly what `charge` credits to the merchant — never
 * a percentage of a rounded display string.
 */
function FeePreview({
  split,
  feeBps,
  meta,
}: {
  split: FeeSplit;
  feeBps: number;
  meta: TokenMeta;
}) {
  return (
    <span>
      Subscriber pays {formatAmount(split.gross, meta)} · protocol fee{" "}
      {formatAmount(split.fee, meta)} ({formatFeeBps(feeBps)}) · you receive{" "}
      {formatAmount(split.net, meta)}.
    </span>
  );
}

export default function MerchantPage() {
  const { address, networkMismatch, signXdr } = useWallet();
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [mandates, setMandates] = useState<ApiMandate[] | null>(null);
  const [summary, setSummary] = useState<MerchantSummary | null>(null);
  const [feeBps, setFeeBps] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [period, setPeriod] = useState(2_592_000);
  const [trial, setTrial] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  // Ending is permanent, so the End button asks for a second click.
  const [confirmEnd, setConfirmEnd] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Plans are published in the configured token; mandates carry their own.
  const metas = useTokenMetas([
    config.contracts.token,
    ...(plans ?? []).map((p) => p.token),
    ...(mandates ?? []).map((m) => m.token ?? config.contracts.token),
  ]);
  const tokenMeta = metaFor(metas, config.contracts.token);

  // The contract rejects a name over MAX_NAME_LEN bytes, so catch it here
  // rather than letting the user pay for a transaction that will fail.
  const nameTooLong = nameByteLength(name.trim()) > MAX_NAME_LEN;
  // Same reasoning for the price: a bad one only fails once the wallet has
  // already opened, so the form says so up front and keeps Publish disabled.
  // The message waits for a first keystroke — an untouched empty field is not
  // an error, and saying so the moment the page loads reads as an accusation.
  // The field is checked against the publish token's decimals, not a hardcoded
  // 7: a SEP-41 token picks its own scale.
  const priceCheck = checkAmount(price, tokenMeta.decimals);
  const priceError = priceCheck.ok ? null : priceCheck.message;
  const showPriceError = priceError !== null && (priceTouched || price.trim() !== "");
  const split = priceCheck.ok ? feeSplit(priceCheck.stroops, feeBps ?? 0) : null;
  const trialSupported = (plans ?? []).some(supportsTrials);

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

  // Read once per wallet, not on every reload: the protocol fee only moves
  // when an admin changes it, and this is a preview rather than a gate — if the
  // read fails the form still publishes, it just shows a 0% split.
  useEffect(() => {
    if (!address) return;
    let live = true;
    void payflow
      .feeBps(address)
      .then((bps) => {
        if (live && Number.isFinite(bps)) setFeeBps(bps);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [address]);

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
          loading={summary === null}
          value={
            summary?.totalCollected
              ? fromStroops(summary.totalCollected, 4, tokenMeta.decimals)
              : "—"
          }
          hint={`${tokenMeta.symbol}, net of protocol fee`}
        />
        <Stat
          label="Active mandates"
          loading={summary === null}
          value={summary?.activeMandates ?? "—"}
        />
        <Stat
          label="Charges settled"
          loading={summary === null}
          value={summary?.chargeCount ?? "—"}
        />
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
              Price ({tokenMeta.symbol})
            </label>
            <input
              id="price"
              className={`input ${showPriceError ? "border-rose-500/60 focus:border-rose-500/60" : ""}`}
              inputMode="decimal"
              placeholder="1.0"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                setPriceTouched(true);
              }}
              onBlur={() => setPriceTouched(true)}
              aria-invalid={showPriceError}
              aria-describedby="price-preview"
            />
          </div>
          <div className="min-w-[12rem] flex-1">
            <label className="label" htmlFor="plan-name">
              Plan name
            </label>
            <input
              id="plan-name"
              className="input"
              placeholder="Pro Monthly"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={nameTooLong}
              aria-describedby={nameTooLong ? "plan-name-error" : undefined}
            />
            {nameTooLong && (
              <p id="plan-name-error" className="mt-1 text-sm text-rose-200">
                Too long — {MAX_NAME_LEN} bytes maximum.
              </p>
            )}
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
          {trialSupported && (
            <div className="min-w-[10rem] flex-1">
              <label className="label" htmlFor="trial">
                Free trial
              </label>
              <select
                id="trial"
                className="input"
                value={trial}
                onChange={(e) => setTrial(Number(e.target.value))}
              >
                <option value={0}>None</option>
                {TRIAL_OPTIONS.map((o) => (
                  <option key={o.seconds} value={o.seconds}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null || networkMismatch || nameTooLong || !priceCheck.ok}
            onClick={() => {
              // Publish the amount the form already parsed rather than reading
              // the field again: a half-typed "1." passes `checkAmount` but
              // `toStroops` rejects, so re-parsing here would throw on a
              // click the form had just said was fine.
              if (!priceCheck.ok) return;
              void run("create", () =>
                payflow.createPlan(address, signXdr, {
                  token: config.contracts.token,
                  amount: priceCheck.stroops,
                  period,
                  name: name.trim(),
                  // Omitted, not zeroed, when unsupported: the deployed
                  // contract's create_plan takes five arguments and a sixth
                  // would fail every publish.
                  ...(trialSupported ? { trial } : {}),
                }),
              );
            }}
          >
            {busy === "create" ? "Publishing…" : "Publish plan"}
          </button>
        </div>

        <p
          id="price-preview"
          aria-live="polite"
          className={showPriceError ? "mt-3 text-sm text-rose-200" : "mt-3 text-sm text-muted"}
        >
          {showPriceError
            ? priceError
            : (split ? (
                <FeePreview split={split} feeBps={feeBps ?? 0} meta={tokenMeta} />
              ) : null)}
        </p>
      </Panel>

      <Panel title="My plans">
        {plans === null ? (
          <SkeletonRows rows={2} label="Loading plans" />
        ) : plans.length === 0 ? (
          <Empty>No plans yet.</Empty>
        ) : (
          <div className="space-y-3">
            {plans.map((p) => {
              const meta = metaFor(metas, p.token);
              return (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge p-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name || `Plan #${p.id}`}</span>
                      <Badge status={p.active ? "Active" : "Paused"} />
                      {trialBadge(p) && (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                          {trialBadge(p)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-muted">
                      {fromStroops(p.amount, 4, meta.decimals)} {meta.symbol}{" "}
                      {formatPeriod(p.period)}
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
              );
            })}
          </div>
        )}
      </Panel>

      <Panel
        title="Subscribers"
        subtitle="Charging is permissionless — you can settle a due mandate yourself instead of waiting for the keeper."
      >
        {mandates === null ? (
          <SkeletonRows rows={3} label="Loading subscribers" />
        ) : mandates.length === 0 ? (
          <Empty>No subscribers yet.</Empty>
        ) : (
          <div className="space-y-3">
            {mandates.map((m) => {
              const due = m.status === "Active" && m.next_charge * 1000 <= Date.now();
              const meta = metaFor(metas, m.token ?? config.contracts.token);
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
                      {m.ended_by === "merchant" && (
                        <span className="text-xs text-muted">ended by you</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {fromStroops(m.amount, 4, meta.decimals)} {meta.symbol}{" "}
                      {formatPeriod(m.period)} · {m.charges_made} settled · next{" "}
                      {m.status === "Active" ? formatWhen(m.next_charge) : "—"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
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
                    {endable(m) &&
                      (confirmEnd === m.id ? (
                        <>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy !== null}
                            onClick={() => setConfirmEnd(null)}
                          >
                            Keep
                          </button>
                          <button
                            type="button"
                            className="btn-danger"
                            disabled={busy !== null || networkMismatch}
                            onClick={() =>
                              void run(`end-${m.id}`, () =>
                                payflow.endMandate(address, signXdr, m.id),
                              ).then(() => setConfirmEnd(null))
                            }
                          >
                            {busy === `end-${m.id}` ? "Ending…" : "Confirm: end for good"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={busy !== null || networkMismatch}
                          onClick={() => setConfirmEnd(m.id)}
                          aria-label={`End subscription #${m.id}`}
                        >
                          End
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
