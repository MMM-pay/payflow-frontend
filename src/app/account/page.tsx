"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ApiMandate, type ApiVaultEvent } from "@/lib/api";
import { buildUpcomingChargesCalendar, CALENDAR_FILENAME } from "@/lib/calendar";
import {
  chainMandatesOf,
  sortVaultEventsNewestFirst,
  vaultEventAmount,
  vaultEventLabel,
  vaultEventTone,
} from "@/lib/chain";
import { config } from "@/lib/config";
import { payflow } from "@/lib/payflow";
import { mandateStatus } from "@/lib/payflow";
import { useWallet } from "@/lib/wallet";
import { formatPeriod, fromStroops, parseAmount } from "@/lib/format";
import { describeTrialEnd } from "@/lib/trial";
import { metaFor, useTokenMetas } from "@/lib/token";
import { AmountInput } from "@/components/AmountInput";
import {
  Badge,
  Empty,
  MerchantAccount,
  Notice,
  Panel,
  SkeletonRows,
  Stat,
  TimeAgo,
  TxLink,
} from "@/components/ui";

export default function AccountPage() {
  const { address, networkMismatch, signXdr } = useWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [mandates, setMandates] = useState<ApiMandate[] | null>(null);
  const [history, setHistory] = useState<ApiVaultEvent[] | null>(null);
  const [indexerAvailable, setIndexerAvailable] = useState(false);
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
    const [bal, res, hist] = await Promise.allSettled([
      payflow.vaultBalance(address, address, config.contracts.token),
      api.mandatesOf(address),
      api.vaultHistory(address),
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

    // Vault history lives only in the indexer; without a backend there is no
    // contract-side event log to fall back to, so we report what is knowable.
    if (hist.status === "fulfilled" && hist.value) {
      setHistory(sortVaultEventsNewestFirst(hist.value.events));
      setIndexerAvailable(true);
    } else {
      setHistory([]);
      setIndexerAvailable(false);
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

  async function handleCancelAll() {
    if (!address) return;

    const allMandates = await chainMandatesOf(address, address);
    const toCancel = allMandates.filter((m) =>
      mandateStatus(m.status) === "Active" || mandateStatus(m.status) === "Paused",
    );

    if (toCancel.length === 0) {
      setError("No active or paused mandates to cancel.");
      return;
    }

    if (!window.confirm(`This will cancel ${toCancel.length} mandate${toCancel.length !== 1 ? "s" : ""}. Continue?`)) {
      return;
    }

    setBusy("cancel-all");
    setError(null);
    setDone(null);

    const PAGE_SIZE = 50;
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < toCancel.length; i += PAGE_SIZE) {
      const page = toCancel.slice(i, i + PAGE_SIZE);
      const promises = page.map((m) =>
        payflow.cancel(address, signXdr, m.id).then(() => {
          completed += 1;
        }).catch((err) => {
          failed += 1;
          setError(
            err instanceof Error ? err.message : String(err),
          );
        }),
      );
      await Promise.all(promises);
    }

    const result = completed
      ? `Cancelled ${completed} mandate${completed !== 1 ? "s" : ""}${
          failed > 0 ? ` (${failed} failed)` : ""
        }`
      : "No mandates were cancelled";

    setDone(result);
    await load();
    setBusy(null);
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
            <AmountInput
              id="amount"
              label={`Amount (${vaultMeta.symbol})`}
              value={amount}
              onChange={setAmount}
              decimals={vaultMeta.decimals}
              placeholder="5.0"
              disabled={busy !== null}
              hint="Accepts 5, 5.0 — and 5,0 where commas are decimals."
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
                  parseAmount(amount, vaultMeta.decimals),
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
                  parseAmount(amount, vaultMeta.decimals),
                ),
              )
            }
          >
            {busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
      </Panel>

      <Panel
        title="Vault history"
        subtitle="Deposits, withdrawals and debits behind your balance."
      >
        {history === null ? (
          <Empty>Loading history…</Empty>
        ) : history.length === 0 ? (
          <Empty>No vault events yet.</Empty>
        ) : (
          <div className="space-y-2">
            {history.map((event) => {
              const label = vaultEventLabel(event);
              const eventAmount = vaultEventAmount(event);
              const isCredit = vaultEventTone(event) === "ok";
              return (
                <div
                  key={event.tx_hash}
                  className="flex items-center justify-between gap-3 rounded-lg border border-edge p-3"
                  aria-label={`${label} ${eventAmount} ${vaultMeta.symbol}, ledger ${event.ledger}`}
                >
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-medium">{label}</span>
                    <span className="mono text-xs text-muted">tx</span>
                    <TxLink hash={event.tx_hash} />
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-semibold tabular-nums ${
                        isCredit ? "text-accent" : "text-rose-300"
                      }`}
                    >
                      {eventAmount} {vaultMeta.symbol}
                    </span>
                    <div className="text-xs text-muted">ledger {event.ledger}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!indexerAvailable && (
          <Notice tone="info">
            Vault history is not available in contract-only mode. It requires
            the payflow-backend indexer (set NEXT_PUBLIC_API_URL). Deposits,
            withdrawals and debits still update your on-chain balance; only
            the event list is missing.
          </Notice>
        )}
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
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                className="btn-primary"
                disabled={busy !== null || networkMismatch}
                onClick={handleCancelAll}
              >
                {busy !== null || networkMismatch ? "Cancelling…" : "Cancel all"}
              </button>
            </div>
            {mandates.map((m) => {
              const terminal = m.status === "Cancelled" || m.status === "Completed";
              const meta = metaFor(metas, m.token ?? config.contracts.token);
              const trial = describeTrialEnd(m);
              return (
                <div key={m.id} className="rounded-lg border border-edge p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Mandate #{m.id}</span>
                        <Badge status={m.status} />
                        {trial && (
                          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                            Free trial
                          </span>
                        )}
                        {m.ended_by === "merchant" && (
                          <span className="text-xs text-muted">ended by the merchant</span>
                        )}
                      </div>
                      <div className="mt-1 text-sm text-muted">
                        {fromStroops(m.amount, 4, meta.decimals)} {meta.symbol}{" "}
                        {formatPeriod(m.period)} · to <MerchantAccount value={m.merchant} />
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {m.charges_made} charge{m.charges_made === 1 ? "" : "s"} taken
                        {m.max_charges > 0 && ` of ${m.max_charges}`}
                        {" · next "}
                        {m.status === "Active" ? <TimeAgo value={m.next_charge} /> : "—"}
                      </div>
                      {trial && (
                        <div className="mt-1 text-xs text-accent">
                          {trial}. Cancel before then and you pay nothing.
                        </div>
                      )}
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
