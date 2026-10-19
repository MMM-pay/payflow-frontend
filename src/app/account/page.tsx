"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ApiMandate } from "@/lib/api";
import { buildUpcomingChargesCalendar, CALENDAR_FILENAME } from "@/lib/calendar";
import { chainMandatesOf } from "@/lib/chain";
import { config } from "@/lib/config";
import { payflow } from "@/lib/payflow";
import { useWallet } from "@/lib/wallet";
import { formatPeriod, formatWhen, fromStroops, toStroops } from "@/lib/format";
import { metaFor, useTokenMetas } from "@/lib/token";
import {
  AddressLink,
  Badge,
  Empty,
  Notice,
  Panel,
  SkeletonRows,
  Stat,
  TxLink,
} from "@/components/ui";

export default function AccountPage() {
  const { address, networkMismatch, signXdr } = useWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [mandates, setMandates] = useState<ApiMandate[] | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // The vault holds the configured token; each mandate carries the token it
  // was opened against, which the indexer does not report.
  const metas = useTokenMetas([
    config.contracts.token,
    ...(mandates ?? []).map((m) => m.token ?? config.contracts.token),
  ]);
  const vaultMeta = metaFor(metas, config.contracts.token);

  const load = useCallback(async () => {
    if (!address) return;
    const [bal, res] = await Promise.allSettled([
      payflow.vaultBalance(address, address, config.contracts.token),
      api.mandatesOf(address),
    ]);
    if (bal.status === "fulfilled") setBalance(bal.value);

    if (res.status === "fulfilled" && res.value) {
      setMandates(res.value.mandates);
    } else {
      // No indexer: read the subscriber's mandates from the contract.
      try {
        setMandates(await chainMandatesOf(address, address));
      } catch {
        setMandates([]);
      }
    }
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

  const activeCount = mandates?.filter((m) => m.status === "Active").length ?? 0;

  /**
   * The .ics is generated in the browser from the same mandates shown on this
   * page, so the calendar also works when the indexer is unreachable and the
   * list came from contract state.
   */
  function downloadCalendar() {
    if (!mandates) return;
    try {
      const calendar = buildUpcomingChargesCalendar(mandates);
      const blob = new Blob([calendar], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = CALENDAR_FILENAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoke after the browser has started the download.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the calendar file.");
    }
  }

  if (!address) {
    return (
      <Panel title="My account">
        <Empty>Connect a wallet to see your vault balance and subscriptions.</Empty>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Vault balance"
          loading={balance === null}
          value={`${fromStroops(balance ?? 0n, 4, vaultMeta.decimals)} ${vaultMeta.symbol}`}
          hint="Available to be charged"
        />
        <Stat
          label="Active subscriptions"
          loading={mandates === null}
          value={activeCount}
        />
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {done && (
        <Notice tone="ok">
          Done. Transaction <TxLink hash={done} />
        </Notice>
      )}

      <Panel
        title="Fund your vault"
        subtitle="Charges are debited from this balance. Withdraw at any time — nothing is locked."
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <label className="label" htmlFor="amount">
              Amount ({vaultMeta.symbol})
            </label>
            <input
              id="amount"
              className="input"
              inputMode="decimal"
              placeholder="5.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null || networkMismatch}
            onClick={() =>
              void run("deposit", () =>
                payflow.deposit(
                  address,
                  signXdr,
                  config.contracts.token,
                  toStroops(amount, vaultMeta.decimals),
                ),
              )
            }
          >
            {busy === "deposit" ? "Depositing…" : "Deposit"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy !== null || networkMismatch}
            onClick={() =>
              void run("withdraw", () =>
                payflow.withdraw(
                  address,
                  signXdr,
                  config.contracts.token,
                  toStroops(amount, vaultMeta.decimals),
                ),
              )
            }
          >
            {busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
      </Panel>

      <Panel
        title="My subscriptions"
        subtitle="Add the next charge of each active mandate to Google or Apple Calendar."
        actions={
          <button
            type="button"
            className="btn-ghost whitespace-nowrap"
            disabled={activeCount === 0}
            onClick={downloadCalendar}
            title={
              activeCount === 0
                ? "No active subscriptions to add"
                : "Download an .ics file for Google or Apple Calendar"
            }
          >
            Add to calendar
          </button>
        }
      >
        {mandates === null ? (
          <SkeletonRows rows={2} label="Loading subscriptions" />
        ) : mandates.length === 0 ? (
          <Empty>No subscriptions yet.</Empty>
        ) : (
          <div className="space-y-3">
            {mandates.map((m) => {
              const terminal = m.status === "Cancelled" || m.status === "Completed";
              const meta = metaFor(metas, m.token ?? config.contracts.token);
              return (
                <div key={m.id} className="rounded-lg border border-edge p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Mandate #{m.id}</span>
                        <Badge status={m.status} />
                        {m.ended_by === "merchant" && (
                          <span className="text-xs text-muted">ended by the merchant</span>
                        )}
                      </div>
                      <div className="mt-1 text-sm text-muted">
                        {fromStroops(m.amount, 4, meta.decimals)} {meta.symbol}{" "}
                        {formatPeriod(m.period)} · to <AddressLink value={m.merchant} />
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {m.charges_made} charge{m.charges_made === 1 ? "" : "s"} taken
                        {m.max_charges > 0 && ` of ${m.max_charges}`}
                        {" · next "}
                        {m.status === "Active" ? formatWhen(m.next_charge) : "—"}
                      </div>
                    </div>

                    {!terminal && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={busy !== null || networkMismatch}
                          onClick={() =>
                            void run(`pause-${m.id}`, () =>
                              payflow.setPaused(
                                address,
                                signXdr,
                                m.id,
                                m.status === "Active",
                              ),
                            )
                          }
                        >
                          {m.status === "Active" ? "Pause" : "Resume"}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-rose-300"
                          disabled={busy !== null || networkMismatch}
                          onClick={() =>
                            void run(`cancel-${m.id}`, () =>
                              payflow.cancel(address, signXdr, m.id),
                            )
                          }
                        >
                          Cancel
                        </button>
                      </div>
                    )}
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
