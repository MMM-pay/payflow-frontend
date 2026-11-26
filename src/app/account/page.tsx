"use client";

import { GracePeriodBadge } from "@/components/GracePeriodBadge";
import { InfoTip } from "@/components/Tooltip";
import { useI18n } from "@/i18n/provider";

import { lazy, Suspense, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
// `/base` is the SDK without the RPC client or transaction builder: StrKey is
// a self-contained checksum helper, so importing it must not cost a bundle.
import { StrKey } from "@stellar/stellar-sdk/base";
import { api, type ApiMandate, type ApiVaultEvent, type StreamEvent } from "@/lib/api";
import { buildUpcomingChargesCalendar, CALENDAR_FILENAME } from "@/lib/calendar";
import {
  buildPaymentsCsv,
  downloadCsv,
  paymentsFilename,
  type PaymentRow,
} from "@/lib/csv";
import {
  chainMandatesOf,
  sortVaultEventsNewestFirst,

  vaultEventLabel,
  vaultEventTone,
} from "@/lib/chain";
import { config, type ConfiguredToken } from "@/lib/config";

const DEFAULT_TOKENS: readonly ConfiguredToken[] = [
  {
    id: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    symbol: "XLM",
    name: "Stellar Lumens",
    decimals: 7,
  },
  {
    id: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    classicAsset: {
      code: "USDC",
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    },
  },
];
import { nextChargeAmount, remainingDiscountCharges } from "@/lib/discount";
import { mandateIsPastDue, mandatePastDueUntil, mandatePauseUntil, mandateSupportsSpendLimit, validateRecipient } from "@/lib/payflow-core";
// The SDK-backed contract module loads on demand, so the Stellar SDK
// stays out of this route's first-load bundle.
import { loadPayflow, payflow, server } from "@/lib/lazy-payflow";
import { mandatePendingTransfer, mandateSupportsTransfer } from "@/lib/payflow-core";
import { groupMandatesByStatus, mandateStatus } from "@/lib/mandate-status";
import { createdAtDate, paymentDateRange, paymentRow, sortPaymentsNewestFirst } from "@/lib/payments";
import {
  buildReceiptData,
  downloadReceipt,
  formatReceiptDate,
  type ReceiptData,
} from "@/lib/receipt";
import { vaultCommitment } from "@/lib/vault";
import { useWallet } from "@/lib/wallet";
import { useStream } from "@/lib/stream";
import {
  addReminder,
  buildReminderSchedule,
  hasReminder,
  pruneEndedReminders,
  readReminderPrefs,
  reminderEligible,
  removeReminder,
  saveReminderPrefs,
  type ReminderPrefs,
  type ScheduledReminder,
} from "@/lib/reminders";
import {
  checkWithdraw,
  fromStroops,
  minPauseDate,
  parsePauseDate,
  resumeDate,
  shortAddress,
  maxDeposit,
} from "@/lib/format";
import { buildChargeSchedule, chargeShortfall } from "@/lib/schedule";
import { computeVaultRunway } from "@/lib/runway";

import { loadTokenMeta, metaFor, useTokenMetas } from "@/lib/token";
import { VirtualList } from "@/components/VirtualList";
import { cursorPage, TABLE_PAGE_SIZE } from "@/lib/pagination";
import { AmountInput } from "@/components/AmountInput";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { confirmTitle } from "@/lib/confirm-title";
import { observeContractRecord } from "@/lib/contract-compat";
import { ContractVersionNotice } from "@/components/ContractVersionNotice";
import { SyncLagIndicator } from "@/components/SyncLagIndicator";
import { StaleDataNotice } from "@/components/StaleDataNotice";
import { Money } from "@/components/Money";
import { NotificationCentre } from "@/components/NotificationCentre";
import { evaluateSubscriberNotifications } from "@/lib/notifications";
import { LoadingButton } from "@/components/LoadingButton";
import {
  Badge,
  Empty,
  InlineError,
  MerchantAccount,
  Notice,
  Panel,
  SkeletonRows,
  Stat,
  TimeAgo,
  TxLink,
} from "@/components/ui";

interface PaymentRecord {
  row: PaymentRow;
  /** Built once when the history loads; its date is filled in on download. */
  receipt: ReceiptData;
}

type PaymentsState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "data"; rows: PaymentRecord[] };

const PaginationControl = lazy(() =>
  import("@/components/Pagination").then((module) => ({
    default: module.Pagination,
  })),
);

/**
 * Past charges with a receipt per row.
 *
 * The list itself comes from the indexer and is read-only, so it stays
 * available to someone viewing an account they do not control. Downloading
 * writes a standalone HTML file; a transaction's close time is fetched only
 * when the button is pressed, so opening the page never fires one RPC request
 * per historical charge.
 */
function PaymentHistoryPanel({
  state,
  onRetry,
}: {
  state: PaymentsState;
  onRetry: () => void;
}) {
  const { t: tr, translateMessage } = useI18n();
  const [busyHash, setBusyHash] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const visibleRows =
    state.status === "data" ? cursorPage(state.rows, cursor) : [];

  async function download(record: PaymentRecord) {
    setBusyHash(record.row.txHash);
    let receipt = record.receipt;
    try {
      const tx = await server.getTransaction(record.row.txHash);
      if (tx && typeof tx === "object" && "createdAt" in tx && typeof tx.createdAt === "number") {
        const raw = tx.createdAt;
        const timestamp = raw > 1e12 ? raw : raw * 1000;
        receipt = { ...receipt, timestamp, date: formatReceiptDate(timestamp) };
      }
    } catch {
      // RPC history is finite; the receipt still downloads with its ledger
      // and a dash for the date rather than inventing one.
    }
    void downloadReceipt(receipt);
    setBusyHash(null);
  }

  return (
    <Panel
      title={tr("Payment history")}
      subtitle={tr("Every settled charge against your subscriptions, with a receipt you can download.")}
    >
      {state.status === "loading" ? (
        <SkeletonRows rows={2} label={tr("Loading payment history")} />
      ) : state.status === "unavailable" ? (
        <Notice tone="info">{tr("Payment history requires the payflow indexer (set NEXT_PUBLIC_API_URL). The chain records how many charges each subscription has taken, but not their amounts, fees or transaction hashes, so no receipt can be built from contract state alone.")}</Notice>
      ) : state.status === "error" ? (
        <div className="space-y-3">
          <Notice tone="error">{translateMessage(state.message)}</Notice>
          <button type="button" className="btn-ghost" onClick={onRetry}>{tr("Retry")}</button>
        </div>
      ) : state.rows.length === 0 ? (
        <Empty title={tr("No charges yet")}>{tr("Charges appear here with a downloadable receipt once they settle on-chain.")}</Empty>
      ) : (
        <>
          <div
            className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            role="region"
            aria-label={tr("Payment history table")}
            tabIndex={0}
          >
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">{tr("Charges settled against your subscriptions, newest first.")}</caption>
              <thead>
                <tr className="border-b border-edge text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">{tr("Subscription")}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{tr("Ledger")}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{tr("Amount")}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{tr("Fee")}</th>
                  <th scope="col" className="py-2 text-right font-medium">{tr("Receipt")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((record) => {
                  const { row } = record;
                  const label = tr("Receipt for charge {0} on subscription #{1}", {
                    "0": row.txHash.slice(0, 8),
                    "1": row.mandateId,
                  });
                  return (
                    <tr key={`${row.mandateId}:${row.txHash}`} className="border-b border-edge last:border-0">
                      <th scope="row" className="py-2 pr-3 font-medium">#{row.mandateId}</th>
                      <td className="py-2 pr-3 tabular-nums text-muted">#{row.ledger}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.amount} {row.token}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted">{row.fee} {row.token}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Link
                            href={`/receipt/?tx=${encodeURIComponent(row.txHash)}&mandate=${row.mandateId}`}
                            className="btn-ghost text-xs"
                            aria-label={tr("Open {0}", { "0": label })}
                          >{tr("View")}</Link>
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={busyHash === row.txHash}
                            aria-label={tr("Download {0}", { "0": label })}
                            onClick={() => void download(record)}
                          >
                            {busyHash === row.txHash ? tr("Preparing…") : tr("Download")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {state.rows.length > TABLE_PAGE_SIZE && (
            <Suspense fallback={null}>
              <PaginationControl
                cursor={cursor}
                limit={TABLE_PAGE_SIZE}
                total={state.rows.length}
                onCursorChange={setCursor}
              />
            </Suspense>
          )}
        </>
      )}
    </Panel>
  );
}

function AccountInner() {
  const { checkAmount, t: tr, formatDate, parseAmount, formatAmount, formatPeriod, translateMessage, describeTrialEnd, discountBadge, formatTokenValue, formatNumber, localeTag } = useI18n();
  const searchParams = useSearchParams();
  const paramAddress = searchParams?.get("address");
  const targetAddress =
    paramAddress && StrKey.isValidEd25519PublicKey(paramAddress.trim())
      ? paramAddress.trim()
      : null;

  const { address, networkMismatch, signXdr, connect, connecting, refreshAccount } =
    useWallet();

  // The account whose data is displayed on screen
  const viewAddress = targetAddress ?? address;
  // Read-only mode applies if an address parameter was supplied and either no wallet
  // is connected or the connected wallet's address differs from the target.
  const isReadOnly = Boolean(targetAddress && (!address || address !== targetAddress));

  const [balance, setBalance] = useState<bigint | null>(null);
  const [mandates, setMandates] = useState<ApiMandate[] | null>(null);
  const [history, setHistory] = useState<ApiVaultEvent[] | null>(null);
  const [payments, setPayments] = useState<PaymentsState>({ status: "loading" });
  // Bumped by the history panel's Retry button to re-run the charges fetch.
  const [paymentsReload, setPaymentsReload] = useState(0);
  const [indexerAvailable, setIndexerAvailable] = useState(false);
  const [amount, setAmount] = useState("");
  // The wallet reports the native balance through its account state; a
  // balance it has not read yet is null, not zero.
  const { account: nativeAccount } = useWallet();
  const nativeBalance =
    nativeAccount?.state === "loaded" ? nativeAccount.account.balance : null;
  const [busy, setBusy] = useState<string | null>(null);
  // Cancelling is permanent, so the first click only reveals Keep/Confirm.
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);
  // The mandates a "Cancel all" press would cancel, once they are loaded.
  // Keeping them in state lets the standard confirmation dialog replace the
  // unstyled `window.confirm` that used to guard this irreversible batch.
  const [cancelAllTargets, setCancelAllTargets] = useState<ApiMandate[] | null>(null);
  // The mandate whose date picker is open, and the date typed into it.
  const [pauseFor, setPauseFor] = useState<number | null>(null);
  const [pauseDate, setPauseDate] = useState("");
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // When the projections on this page were last received, for staleness.
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [capFor, setCapFor] = useState<number | null>(null);
  const [capAmount, setCapAmount] = useState("");
  const [capError, setCapError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Whether the mandate list came from the indexer. Payment history lives only
  // there, so this is what gates the CSV export.
  const [mandatesFromApi, setMandatesFromApi] = useState(false);
  // Whether the deployed vault contract supports depositing into another
  // account's vault (payflow-contract#29). null while the probe is in flight.
  const [fundSupport, setFundSupport] = useState<boolean | null>(null);
  const [fundRecipient, setFundRecipient] = useState("");
  const [fundAmount, setFundAmount] = useState("");
  // The recipient awaiting a second-click confirmation — one at a time.
  const [fundFor, setFundFor] = useState<string | null>(null);
  // The mandate whose transfer form is open, and the new address typed into
  // it. Like `confirmCancel`, one at a time keeps the pending write clear.
  const [transferFor, setTransferFor] = useState<number | null>(null);
  const [transferTo, setTransferTo] = useState("");
  // Whether the deployed mandate contract supports the two-step transfer
  // (payflow-contract#68). null while the probe is in flight.
  const [transferSupport, setTransferSupport] = useState<boolean | null>(null);

  // Track who paused each mandate: "subscriber" | "merchant" | undefined
  // Updated by the SSE stream when available.
  const [pausedBy, setPausedBy] = useState<Map<number, "subscriber" | "merchant">>(new Map());
  const [missingTrustlines, setMissingTrustlines] = useState<ConfiguredToken[]>([]);
  // Reminder preferences are per connected address. Loading them never asks
  // for notification permission; only the "Remind me" click can do that.
  const [reminderPrefs, setReminderPrefs] = useState<ReminderPrefs>({});
  const [reminderBusy, setReminderBusy] = useState<number | null>(null);
  // Notifications already shown for a particular charge, so a reload or a
  // data refresh does not repeat one the subscriber has seen.
  const shownReminders = useRef<Set<string>>(new Set());

  const configuredTokens: readonly ConfiguredToken[] =
    (config as unknown as { tokens?: ConfiguredToken[] }).tokens ?? DEFAULT_TOKENS;

  // Read inside async callbacks to detect a wallet account switch mid-load:
  // the closure's `who` is the account the request started for, which may
  // no longer be the account whose page is on screen.
  const addressRef = useRef<string | null>(viewAddress);
  // The guard is kept current in an effect rather than during render
  // (react-hooks/refs). Reads happen in async callbacks; the effect flushes
  // long before any wallet prompt resolves, so a switch mid-load is still
  // caught.
  useEffect(() => {
    addressRef.current = viewAddress;
  }, [viewAddress]);
  // Once the page unmounts no address is current, so every guarded callback
  // returns instead of setting state on a page that is gone.
  useEffect(() => {
    return () => {
      addressRef.current = null;
    };
  }, []);

  // The vault holds the configured token; each mandate carries the token it
  // was opened against, which the indexer does not report.
  const metas = useTokenMetas([
    config.contracts.token,
    ...configuredTokens.map((t) => t.id),
    ...(mandates ?? []).map((m) => m.token ?? config.contracts.token),
  ]);
  const vaultMeta = metaFor(metas, config.contracts.token);

  /** Whether the recipient address and amount are right to submit right now. */
  const recipientDisplayError = fundRecipient.trim()
    ? validateRecipient(fundRecipient)
    : null;
  const fundAmountCheck = checkAmount(fundAmount, vaultMeta.decimals);
  const fundStroops = fundAmountCheck.ok ? fundAmountCheck.stroops : 0n;

  /** Whether the new address typed into a transfer form is a valid G… StrKey. */
  const transferDisplayError = transferTo.trim()
    ? validateRecipient(transferTo)
    : null;

  /** Whether the amount can be withdrawn right now: parses and fits the vault. */
  const withdrawCheck = checkWithdraw(amount, balance, vaultMeta.decimals, localeTag);
  // The amount field shows its own message for a malformed entry; anything
  // else (too large for the balance, balance still loading) is the
  // withdrawal's to explain, so only one message is on screen at a time.
  const withdrawError = amount.trim() !== "" && !withdrawCheck.ok ? withdrawCheck.message : null;

  // Source account for simulation
  const source = address ?? config.readSource;

  // Load function defined early so it can be referenced by the SSE stream hook
  const load = useCallback(async () => {
    addressRef.current = viewAddress;
    if (!viewAddress) return;
    setRefreshing(true);
    const who = viewAddress;
    const [bal, res, hist] = await Promise.allSettled([
      payflow.vaultBalance(source, who, config.contracts.token),
      api.mandatesOf(who),
      api.vaultHistory(who),
    ]);
    // The wallet may have switched accounts while those reads were in flight.
    // Applying them would show one account's balance under another's address.
    if (addressRef.current !== who) return;
    if (bal.status === "fulfilled") setBalance(bal.value);

    if (res.status === "fulfilled" && res.value) {
      res.value.mandates.forEach((mandate) => observeContractRecord("mandate", mandate));
      setMandates(res.value.mandates);
      setMandatesFromApi(true);
    } else {
      // No indexer: read the subscriber's mandates from the contract.
      try {
        const fromChain = await chainMandatesOf(source, who);
        if (addressRef.current !== who) return;
        setMandates(fromChain);
      } catch {
        if (addressRef.current !== who) return;
        setMandates([]);
      }
      setMandatesFromApi(false);
    }

    // A contract fallback above may have awaited long enough for an account
    // switch; do not attach the old account's history to the new one.
    if (addressRef.current !== who) return;

    // Vault history lives only in the indexer; without a backend there is no
    // contract-side event log to fall back to, so we report what is knowable.
    if (hist.status === "fulfilled" && hist.value) {
      setHistory(sortVaultEventsNewestFirst(hist.value.events));
      setIndexerAvailable(true);
    } else {
      setHistory([]);
      setIndexerAvailable(false);
    }

    // Check classic asset trustlines for mandates in other tokens
    if (who && configuredTokens.length > 0) {
      const { checkTrustline } = await loadPayflow();
      const missing: ConfiguredToken[] = [];
      for (const tok of configuredTokens) {
        if (tok.classicAsset) {
          const hasTrust = await checkTrustline(
            who,
            tok.classicAsset.code,
            tok.classicAsset.issuer,
          );
          if (!hasTrust) {
            missing.push(tok);
          }
        }
      }
      if (addressRef.current === who) {
        setMissingTrustlines(missing);
      }
    }
    if (addressRef.current === who) {
      setLastLoadedAt(Date.now());
      setRefreshing(false);
    }
  }, [viewAddress, source, configuredTokens]);

  // SSE stream for live updates (payflow-backend#19)
  useStream({
    address,
    role: "subscriber",
    onEvent: useCallback((event: StreamEvent) => {
      if (event.type === "mandate_pause") {
        setPausedBy((prev) => {
          const next = new Map(prev);
          next.set(event.mandate_id, event.by);
          return next;
        });
      }
      if (event.type === "mandate_status") {
        setPausedBy((prev) => {
          const next = new Map(prev);
          // If status becomes Active, the pause is over
          if (event.status === "Active") {
            next.delete(event.mandate_id);
          }
          return next;
        });
      }
      // For other events (charge, discount, end), trigger a reload
      // to get fresh data from the indexer
      if (event.type === "charge" || event.type === "mandate_discount" || event.type === "mandate_end") {
        void load();
      }
    }, [load]),
    enabled: api.isConfigured(),
  });

  useEffect(() => {
    // A different account means every previous value belongs to someone else:
    // clear them before the new reads start so no stale row or export survives
    // a wallet switch. Clearing here (rather than in `load`) keeps the refresh
    // after a transaction from flashing the page back to skeletons.
    // Use startTransition to avoid synchronous setState warnings.
    startTransition(() => {
      setBalance(null);
      setMandates(null);
      setHistory(null);
      setPayments({ status: "loading" });
      setIndexerAvailable(false);
      setMandatesFromApi(false);
      setInfo(null);
      setError(null);
      setDone(null);
      setExporting(false);
      setLastLoadedAt(null);
      setRefreshing(false);
    });
    void load();
  }, [load]);
  // Use startTransition to batch setState calls and avoid synchronous render warnings
  useEffect(() => {
    startTransition(() => {
      setConfirmCancel(null);
      setPauseFor(null);
      setFundFor(null);
      setTransferFor(null);
      setTransferTo("");
      setReminderBusy(null);
    });
  }, [address]);

  /**
   * Past charges for the receipt list.
   *
   * Charge history exists only in the indexer, so contract-only mode says so
   * rather than pretending there are no payments. A page that cannot read one
   * mandate's history shows an error instead of a partial list that would
   * understate what the subscriber paid.
   */
  useEffect(() => {
    if (!viewAddress) return;
    if (mandates === null) {
      setPayments({ status: "loading" });
      return;
    }
    if (!mandatesFromApi || typeof api.charges !== "function") {
      setPayments({ status: "unavailable" });
      return;
    }
    if (mandates.length === 0) {
      setPayments({ status: "data", rows: [] });
      return;
    }

    let live = true;
    setPayments({ status: "loading" });
    void (async () => {
      try {
        const histories = await Promise.all(
          mandates.map(async (mandate) => ({
            mandate,
            result: await api.charges(mandate.id),
          })),
        );
        if (!live) return;

        // null/undefined means the endpoint or backend is unavailable, which
        // is not the same as "this subscription has no charges".
        if (histories.some(({ result }) => !result)) {
          setPayments({ status: "unavailable" });
          return;
        }

        const records: PaymentRecord[] = [];
        for (const { mandate, result } of histories) {
          if (!result) continue;
          const tokenContract = mandate.token ?? config.contracts.token;
          const meta = await loadTokenMeta(tokenContract);
          for (const charge of result.charges) {
            records.push({
              row: paymentRow(charge, mandate, meta, tokenContract, "—"),
              receipt: buildReceiptData(charge, mandate, meta, null, charge.tx_hash),
            });
          }
        }
        if (!live) return;
        // Sort by the same newest-first rule as the CSV export, then map the
        // order back to the record that carries the pre-built receipt.
        const byKey = new Map(
          records.map((record) => [
            `${record.row.mandateId}:${record.row.txHash}`,
            record,
          ]),
        );
        const sorted = sortPaymentsNewestFirst(records.map((record) => record.row))
          .map((row) => byKey.get(`${row.mandateId}:${row.txHash}`))
          .filter((record): record is PaymentRecord => record !== undefined);
        setPayments({ status: "data", rows: sorted });
      } catch (err) {
        if (!live) return;
        setPayments({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : tr("Could not load payment history."),
        });
      }
    })();

    return () => {
      live = false;
    };
  }, [viewAddress, mandates, mandatesFromApi, paymentsReload, tr]);

  // A wallet switch mid-flow must not leave another account's mandate in the
  // confirming state.
  useEffect(() => {
    // Use startTransition to avoid synchronous setState warnings.
    startTransition(() => {
      setConfirmCancel(null);
      setPauseFor(null);
      setFundFor(null);
      setTransferFor(null);
      setTransferTo("");
      setReminderBusy(null);
    });
  }, [address]);

  // Preferences belong to the connected subscriber, not the browser. Reading
  // them is silent: no permission prompt is allowed on page load.
  useEffect(() => {
    // Use startTransition to avoid synchronous setState warnings.
    if (!address || typeof window === "undefined") {
      startTransition(() => {
        setReminderPrefs({});
      });
      return;
    }
    startTransition(() => {
      setReminderPrefs(readReminderPrefs(window.localStorage, address));
    });
  }, [address]);

  // A mandate that ended — cancelled here, by the merchant, or settled to its
  // charge cap — must stop reminding. `pruneEndedReminders` reads the status
  // through `mandateStatus`, so `["Cancelled"]` from contract state and
  // `"Cancelled"` from the indexer behave the same.
  useEffect(() => {
    // Use startTransition to avoid synchronous setState warnings.
    if (!address || mandates === null || typeof window === "undefined") return;
    startTransition(() => {
      const pruned = pruneEndedReminders(reminderPrefs, mandates);
      if (pruned.removed.length > 0) {
        setReminderPrefs(pruned.prefs);
        saveReminderPrefs(window.localStorage, address, pruned.prefs);
      }
    });
  }, [address, mandates, reminderPrefs]);

  /**
   * Deliver a reminder through the app's service worker when one is
   * installed, so clicking it opens the account page. A browser without a
   * service worker falls back to a page notification.
   */
  const showReminder = useCallback(async (reminder: ScheduledReminder) => {
    if (typeof window === "undefined") return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const options: NotificationOptions & { icon?: string } = {
      body: reminder.body,
      tag: reminder.tag,
      icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icon-192.png`,
    };
    if ("serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration && "showNotification" in registration) {
          await registration.showNotification(reminder.title, options);
          return;
        }
      } catch {
        // Fall through to the page notification below.
      }
    }
    new Notification(reminder.title, options);
  }, []);

  /**
   * Keep the service worker and this tab in step with the reminder set.
   *
   * Where the browser supports scheduled notifications (`TimestampTrigger`),
   * the installed PWA hands the schedule to the service worker and the page
   * sets no timer. Otherwise the page holds the timers for as long as it is
   * open — the limitation the panel text explains.
   */
  useEffect(() => {
    if (!address || typeof window === "undefined" || typeof navigator === "undefined") return;
    const schedule = buildReminderSchedule(mandates ?? [], reminderPrefs, Date.now());
    const payload = schedule.map((reminder) => ({
      id: reminder.mandateId,
      at: reminder.at,
      title: reminder.title,
      body: reminder.body,
      tag: reminder.tag,
    }));

    if ("serviceWorker" in navigator) {
      // Send an empty list when nothing is enabled, which also cancels timers
      // the worker was holding from a previous render.
      navigator.serviceWorker.ready
        .then((registration) => {
          registration.active?.postMessage({ type: "payflow-reminders-sync", reminders: payload });
        })
        .catch(() => {});
    }

    const triggerCtor = (window as unknown as { TimestampTrigger?: unknown }).TimestampTrigger;
    const backgroundScheduling = typeof triggerCtor === "function";
    if (backgroundScheduling) return;

    // `setTimeout` cannot wait longer than 2^31-1 ms (~24.8 days), and a
    // monthly reminder is about 29 days away. Walk to the target in chunks
    // instead of clamping, which would fire days early.
    const timers = schedule.map((reminder) => {
      const key = `${reminder.mandateId}:${reminder.nextCharge}`;
      if (shownReminders.current.has(key)) return () => {};
      let cancelled = false;
      let timer: number | null = null;
      const tick = () => {
        if (cancelled) return;
        const remaining = reminder.at - Date.now();
        if (remaining <= 0) {
          shownReminders.current.add(key);
          void showReminder(reminder);
          return;
        }
        timer = window.setTimeout(tick, Math.min(remaining, 2_147_483_647));
      };
      tick();
      return () => {
        cancelled = true;
        if (timer !== null) window.clearTimeout(timer);
      };
    });

    return () => {
      for (const cancel of timers) cancel();
    };
  }, [address, mandates, reminderPrefs, showReminder]);

  /**
   * Toggle a mandate's reminder. Permission is requested here and nowhere
   * else, after a click — never during render or on page load.
   */
  async function toggleReminder(mandateId: number) {
    if (!address || isReadOnly) return;
    const who = address;
    const enabled = hasReminder(reminderPrefs, mandateId);
    setError(null);
    setInfo(null);

    if (!enabled) {
      if (typeof window === "undefined" || typeof Notification === "undefined") {
        setInfo(tr("This browser does not support notifications. Upcoming charges are still listed here and can be added to your calendar."),
        );
        return;
      }
      setReminderBusy(mandateId);
      let permission = Notification.permission;
      if (permission === "default") {
        try {
          permission = await Notification.requestPermission();
        } catch {
          permission = "denied";
        }
      }
      if (addressRef.current !== who) return;
      setReminderBusy(null);
      if (permission !== "granted") {
        setInfo(tr("Notifications are blocked for this site. Allow them in your browser settings, then try again. Nothing was saved."),
        );
        return;
      }
    }

    const next = enabled
      ? removeReminder(reminderPrefs, mandateId)
      : addReminder(reminderPrefs, mandateId);
    setReminderPrefs(next);
    if (typeof window !== "undefined") {
      saveReminderPrefs(window.localStorage, who, next);
    }
    setInfo(
      enabled
        ? "Reminder off for this subscription."
        : "Reminder on. You will be notified about a day before the next charge while Payflow is open, or in the background where your browser supports scheduled notifications.",
    );
  }

  // Probe whether the deployed vault contract carries deposit_for. The sponsor
  // control stays hidden until the contract answers: a contract that predates
  // payflow-contract#29 cannot service the write, so offering it would only
  // fail at signing time.
  useEffect(() => {
    // Use startTransition to avoid synchronous setState warnings.
    if (!address) {
      startTransition(() => {
        setFundSupport(null);
      });
      return;
    }
    let live = true;
    void loadPayflow()
      .then((mod) => mod.vaultSupportsDepositFor(address))
      .then((supported: boolean) => {
        if (live) setFundSupport(supported);
      });
    return () => {
      live = false;
    };
  }, [address]);

  // Probe whether the deployed mandate contract carries the two-step transfer
  // (payflow-contract#68). The control stays hidden until the contract answers:
  // a contract that predates it cannot service the write, so offering it would
  // only fail at signing time.
  useEffect(() => {
    // Use startTransition to avoid synchronous setState warnings.
    if (!address || mandates === null) {
      startTransition(() => {
        setTransferSupport(null);
      });
      return;
    }
    // The deployed contract either carries `pending_subscriber` on its
    // mandates or it does not; the loaded mandates already say which.
    startTransition(() => {
      setTransferSupport(mandates.some((m) => mandateSupportsTransfer(m)));
    });
  }, [address, mandates]);

  // Identify classic asset tokens in use by the subscriber's mandates
  const classicTokens = useMemo(() => {
    const tokenIds = new Set(
      (mandates ?? []).map((m) => m.token ?? config.contracts.token),
    );
    return configuredTokens.filter((t) => t.classicAsset && tokenIds.has(t.id));
  }, [mandates, configuredTokens]);

  const checkTrustlines = useCallback(async () => {
    if (!viewAddress || classicTokens.length === 0) {
      setMissingTrustlines([]);
      return;
    }
    const { checkTrustline } = await loadPayflow();
    const missing: ConfiguredToken[] = [];
    for (const t of classicTokens) {
      if (t.classicAsset) {
        const has = await checkTrustline(
          viewAddress,
          t.classicAsset.code,
          t.classicAsset.issuer,
        );
        if (!has) missing.push(t);
      }
    }
    setMissingTrustlines(missing);
  }, [viewAddress, classicTokens]);

  useEffect(() => {
    void checkTrustlines();
  }, [checkTrustlines]);

  async function handleAddTrustline(token: ConfiguredToken) {
    if (!address || !token.classicAsset) return;
    try {
      setBusy(`trustline-${token.symbol}`);
      setError(null);
      setDone(null);
      const hash = await payflow.addTrustline(
        address,
        signXdr,
        token.classicAsset.code,
        token.classicAsset.issuer,
      );
      setDone(hash);
      await checkTrustlines();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /** Returns whether `fn` succeeded, so a caller can decide what to do next. */
  async function run(key: string, fn: () => Promise<string>): Promise<boolean> {
    setBusy(key);
    setError(null);
    setDone(null);
    setInfo(null);
    try {
      setDone(await fn());
      await load();
      // Every write here spends the native balance on fees, so the header's
      // figure is stale the moment the transaction lands.
      await refreshAccount();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** Reveal Keep/Confirm for the sponsor deposit. One recipient at a time. */
  async function fundAnother() {
    if (recipientDisplayError || !fundAmountCheck.ok) return;
    setFundFor(fundRecipient.trim());
  }

  async function fundConfirmed() {
    if (!address || !signXdr || !fundFor || !fundAmountCheck.ok) return;
    await run(`fund-for-${fundFor}`, () =>
      payflow.depositFor(address, signXdr, fundFor, config.contracts.token, fundStroops),
    );
    setFundFor(null);
    setFundRecipient("");
    setFundAmount("");
  }

  /** Open the transfer form for a mandate, defaulting to a blank address. */
  function openTransfer(mandateId: number) {
    setTransferFor(mandateId);
    setTransferTo("");
    setConfirmCancel(null);
    setPauseFor(null);
    setError(null);
  }

  async function transferConfirmed(mandateId: number) {
    if (!address || !signXdr || transferDisplayError) return;
    await run(`transfer-${mandateId}`, () =>
      payflow.transferMandate(address, signXdr, mandateId, transferTo.trim()),
    );
    setTransferFor(null);
    setTransferTo("");
  }

  async function acceptTransfer(mandateId: number) {
    if (!address || !signXdr) return;
    await run(`accept-${mandateId}`, () =>
      payflow.acceptMandateTransfer(address, signXdr, mandateId),
    );
  }

  /** Read first, then ask: the dialog counts exactly what it will cancel. */
  async function handleCancelAll() {
    if (!address || isReadOnly) return;

    const allMandates = await chainMandatesOf(address, address);
    const toCancel = allMandates.filter((m) =>
      mandateStatus(m.status) === "Active" || mandateStatus(m.status) === "Paused",
    );

    if (toCancel.length === 0) {
      setError(tr("No active or paused mandates to cancel."));
      return;
    }
    setError(null);
    setCancelAllTargets(toCancel);
  }

  async function cancelAllConfirmed() {
    const toCancel = cancelAllTargets;
    if (!address || isReadOnly || !toCancel) return;

    setBusy("cancel-all");
    setError(null);
    setDone(null);

    const PAGE_SIZE = 50;
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < toCancel.length; i += PAGE_SIZE) {
      const page = toCancel.slice(i, i + PAGE_SIZE);
      const promises = page.map((m) =>
        payflow
          .cancel(address, signXdr, m.id)
          .then(() => {
            completed += 1;
          })
          .catch((err) => {
            failed += 1;
            setError(err instanceof Error ? err.message : String(err));
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
    setCancelAllTargets(null);
    await load();
    setBusy(null);
  }

  const activeCount = mandates?.filter((m) => m.status === "Active").length ?? 0;
  const runway = useMemo(() => {
    return computeVaultRunway(balance, mandates, config.contracts.token);
  }, [balance, mandates]);
  /**
   * How the vault splits between money promised to the next charge of each
   * active mandate and the amount that is freely withdrawable. Null while the
   * balance or mandates are still loading.
   */
  const commitment = useMemo(
    () => vaultCommitment(balance, mandates, config.contracts.token),
    [balance, mandates],
  );
  /** The subscription list, split into active/paused/ended sections. */
  const subscriptionGroups = useMemo(
    () => groupMandatesByStatus(mandates ?? []),
    [mandates],
  );
  // Short visible headings, with the full phrase kept for screen readers so a
  // section name is never confused with the "Active subscriptions" stat above.
  const subscriptionGroupTitles = {
    active: tr("Active"),
    paused: tr("Paused"),
    ended: tr("Ended"),
  } as const;

  /**
   * Whether the contract behind these mandates can service a dated pause.
   */
  const pauseSupported = (mandates ?? []).some(
    (m) => mandatePauseUntil(m) !== null,
  );

  /**
   * Whether the contract behind these mandates can service a transfer.
   *
   * The probe in the effect above answers for the deployed contract; the
   * mandates on screen confirm it too, so a stale probe cannot offer a write
   * the contract would reject.
   */
  const transferAvailable =
    transferSupport === true && (mandates ?? []).some((m) => mandateSupportsTransfer(m));

  function openPausePicker(mandateId: number) {
    if (isReadOnly) return;
    setPauseFor(mandateId);
    const week = new Date(Date.now() + 7 * 86_400_000);
    setPauseDate(week.toISOString().slice(0, 10));
    setPauseError(null);
    setConfirmCancel(null);
    setError(null);
  }

  async function pauseUntil(mandateId: number) {
    if (!address || isReadOnly) return;
    const until = parsePauseDate(pauseDate);
    if (until === null) {
      setPauseError(tr("Pick a date for the mandate to resume on."));
      document.getElementById(`pause-until-${mandateId}`)?.focus();
      return;
    }
    if (until * 1000 <= Date.now()) {
      setPauseError(tr("Pick a date in the future."));
      document.getElementById(`pause-until-${mandateId}`)?.focus();
      return;
    }
    setPauseError(null);
    await run(`pause-until-${mandateId}`, () =>
      payflow.pauseUntil(address, signXdr, mandateId, until),
    );
    setPauseFor(null);
  }

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
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not build the calendar file.",
      );
    }
  }

  function openCapEditor(m: ApiMandate) {
    setCapFor(m.id);
    setCapAmount(m.max_charges > 0 ? String(m.max_charges) : "");
    setCapError(null);
  }

  function submitCap(m: ApiMandate) {
    const raw = capAmount.trim();
    if (!/^\d+$/.test(raw)) {
      setCapError("Enter a whole number of charges.");
      return;
    }
    const next = BigInt(raw);
    if (next < BigInt(m.charges_made)) {
      setCapError(`Cap cannot be below the ${m.charges_made} charge${m.charges_made === 1 ? "" : "s"} already taken.`);
      return;
    }
    setCapError(null);
    if (!address) return;
    const source = address;
    void run(`cap-${m.id}`, async () => {
      const hash = await payflow.setMaxCharges(source, signXdr, m.id, next);
      setCapFor(null);
      return hash;
    });
  }

  /**
   * The date of a charge's transaction.
   *
   * Indexer charges carry a ledger, not a timestamp. The close time is read
   * from the transaction itself and any failure leaves "—": a payment record
   * must not invent today's date for a charge that settled months ago.
   */
  async function chargeDate(txHash: string): Promise<string> {
    try {
      const tx = await server.getTransaction(txHash);
      if ("createdAt" in tx) return createdAtDate(tx.createdAt as number);
    } catch {
      // RPC unavailable or the transaction is older than the node's history.
    }
    return "—";
  }

  /**
   * Export every charge settled against the subscriber's mandates as CSV.
   *
   * Per-charge amounts, fees and hashes exist only in the indexer; contract
   * state keeps just `charges_made`. The button is therefore disabled in
   * contract-only mode instead of shipping an empty file. If any mandate's
   * history cannot be read the whole export aborts: a file that silently omits
   * a subscription would look complete while understating what was paid.
   *
   * Read-only — it signs nothing — so a wallet on the wrong network can still
   * export. The account-change guards only stop one account's rows from being
   * written under another account's address.
   */
  async function exportPayments() {
    if (!viewAddress || !mandates || !mandatesFromApi) return;
    const who = viewAddress;
    setExporting(true);
    setError(null);
    setInfo(null);
    try {
      const histories = await Promise.all(
        mandates.map(async (mandate) => ({ mandate, result: await api.charges(mandate.id) })),
      );
      if (addressRef.current !== who) return;

      const unreadable = histories.filter(({ result }) => result === null);
      if (unreadable.length > 0) {
        throw new Error(tr("Could not read payment history for mandate{0} {1}. Nothing was exported, so the file cannot omit payments.", { "0": unreadable.length === 1 ? "" : "s", "1": unreadable
            .map(({ mandate }) => `#${mandate.id}`)
            .join(", ") }),
        );
      }

      const dateCache = new Map<string, string>();
      const rows: PaymentRow[] = [];
      for (const { mandate, result } of histories) {
        if (!result) continue;
        const tokenContract = mandate.token ?? config.contracts.token;
        // Read the token's metadata here rather than trusting the map rendered
        // above: decimals must be right even if the page has not finished
        // loading them, and a mandate in another token must use its own scale.
        const meta = await loadTokenMeta(tokenContract);
        for (const charge of result.charges) {
          let date = dateCache.get(charge.tx_hash);
          if (date === undefined) {
            date = await chargeDate(charge.tx_hash);
            dateCache.set(charge.tx_hash, date);
          }
          rows.push(paymentRow(charge, mandate, meta, tokenContract, date));
        }
      }
      if (addressRef.current !== who) return;

      if (rows.length === 0) {
        setInfo(tr("No payments to export yet. Charges appear here once they settle on-chain."));
        return;
      }

      const sorted = sortPaymentsNewestFirst(rows);
      const { from, to } = paymentDateRange(sorted);
      downloadCsv(buildPaymentsCsv(sorted), paymentsFilename(who, from, to));
      setInfo(tr("Exported {0} payment{1} to CSV.", { "0": sorted.length, "1": sorted.length === 1 ? "" : "s" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the CSV file.");
    } finally {
      setExporting(false);
    }
  }

  if (!viewAddress) {
    return (
      <Panel title={tr("My account")}>
        <Empty
          title={tr("No wallet connected")}
          action={
            <button
              type="button"
              className="btn-primary"
              disabled={connecting}
              onClick={() => void connect()}
            >
              {connecting ?tr("Connecting…") :tr("Connect wallet")}
            </button>
          }
        >{tr("Connect a wallet to see your vault balance, fund it, and manage your subscriptions. Nothing is sent to the network until you approve a transaction in your wallet.")}</Empty>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      {isReadOnly && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-accent/20 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-accent">{tr("Read-only")}</span>
            <span className="text-sm text-foreground">{tr("Viewing subscriptions for")}{" "}
              <span className="font-mono">{shortAddress(viewAddress, 6)}</span>
            </span>
          </div>
          <span className="text-xs text-muted">{tr("Actions are hidden in read-only mode.")}</span>
        </div>
      )}

      {missingTrustlines.map((t) => (
        <div
          key={t.id}
          role="alert"
          className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-warning"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="font-semibold text-sm">{tr("Trustline required for")}{" "}{t.symbol}</p>
              <p className="text-xs opacity-90">{tr("Your account needs a trustline for")}{" "}{t.name} ({t.symbol}{tr(") before subscriptions in this token can be funded or charged.")}</p>
            </div>
            {!isReadOnly && (
              <button
                type="button"
                className="btn-primary text-xs whitespace-nowrap self-start sm:self-auto"
                disabled={busy !== null || networkMismatch}
                onClick={() => void handleAddTrustline(t)}
              >
                {busy === `trustline-${t.symbol}`
                  ?tr("Adding trustline…")
                  :tr("Add {0} trustline", { "0": t.symbol })}
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label={tr("Vault balance")}
          loading={balance === null}
          value={<Money amount={balance ?? 0n} meta={vaultMeta} />}
          hint={tr("Available to be charged")}
        />
        <Stat
          label={tr("Committed to subscriptions")}
          loading={commitment === null}
          value={<Money amount={commitment?.committed ?? 0n} meta={vaultMeta} />}
          hint={
            commitment && commitment.shortfall > 0n
              ? tr("Short of the next charges by {0}", {
                  "0": formatAmount(commitment.shortfall, vaultMeta),
                })
              : tr("Next charge on each active subscription")
          }
        />
        <Stat
          label={tr("Freely withdrawable")}
          loading={commitment === null}
          value={<Money amount={commitment?.free ?? 0n} meta={vaultMeta} />}
          hint={tr("Balance left after those charges")}
        />
        <Stat
          label={tr("Active subscriptions")}
          loading={mandates === null}
          value={activeCount}
        />
        <Stat
          label={tr("Runway")}
          loading={runway === null}
          value={
            runway
              ? runway.hasActiveMandates
                ? tr(runway.chargesCovered === 1 ? "{0} charge" : "{0} charges", { 0: runway.chargesCovered })
                : tr("No active charges")
              : "…"
          }
          hint={
            runway && runway.hasActiveMandates
              ? runway.runsOutDate
                ?tr("until {0}", { "0": formatDate(runway.runsOutDate) })
                :tr("fully funded")
              :tr("subscriptions billable")
          }
        />
      </div>

      {runway?.isLow && runway.hasActiveMandates && (
        <Notice tone="error">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span>
              <strong>{tr("Low vault balance:")}</strong>{" "}{tr("Covers only")}{" "}{formatNumber(runway.chargesCovered)}{" "}
              {runway.chargesCovered === 1 ?tr("upcoming charge") :tr("upcoming charges")}.{" "}
              {runway.runsOutDate
                ?tr("Funds will run out on {0}.", { "0": formatDate(runway.runsOutDate) })
                :tr("Deposit funds to avoid subscription interruption.")}
            </span>
          </div>
        </Notice>
      )}

      <ContractVersionNotice />
      <SyncLagIndicator />
      <StaleDataNotice
        fetchedAt={lastLoadedAt}
        refreshing={refreshing}
        onRefresh={() => { void load(); }}
        className="mb-4"
      />
      <NotificationCentre
        address={address}
        notifications={evaluateSubscriberNotifications({
          runway,
          mandates,
          vaultMeta,
        })}
        loading={mandates === null || balance === null}
        defaultOpen={Boolean(runway?.isLow && runway.hasActiveMandates)}
        className="mb-4"
      />
      {error && <Notice tone="error">{translateMessage(error)}</Notice>}
      {info && (
        <Notice tone="info">
          {/* Announced when the export finishes, so a screen-reader user knows
              the file was produced without having to hunt for the button. */}
          <span role="status">{translateMessage(info)}</span>
        </Notice>
      )}
      {done && (
        <Notice tone="ok">
          {done.length === 64 ? (
            <>{tr("Done. Transaction")}{" "}<TxLink hash={done} />
            </>
          ) : (
            done
          )}
        </Notice>
      )}

      {!isReadOnly && (
        <Panel
          title={tr("Fund your vault")}
          subtitle={tr(
            "Charges are debited from this balance. Withdraw at any time — nothing is locked, but a withdrawal can stop upcoming charges: the next one fails if it finds the vault short.",
          )}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <AmountInput
                id="amount"
                label={tr("Amount ({0})", { "0": vaultMeta.symbol })}
                value={amount}
                onChange={setAmount}
                decimals={vaultMeta.decimals}
                placeholder="5.0"
                disabled={busy !== null}
                hint={
                  nativeBalance !== null && vaultMeta.symbol === "XLM"
                    ? tr("Wallet balance: {0}", { "0": formatAmount(nativeBalance, vaultMeta) })
                    : tr("Accepts 5, 5.0 — and 5,0 where commas are decimals.")
                }
                hideError={withdrawError !== null}
                invalid={withdrawError !== null}
                {...(withdrawError ? { describedBy: "withdraw-amount-error" } : {})}
              />
              {withdrawError && (
                <InlineError id="withdraw-amount-error">{withdrawError}</InlineError>
              )}
            </div>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy !== null || balance === null || balance === 0n}
              onClick={() =>
                setAmount(fromStroops(balance ?? 0n, vaultMeta.decimals, vaultMeta.decimals))
              }
              aria-label="Fill the amount with the full vault balance"
              title={`Withdraw the full balance (${formatAmount(balance ?? 0n, vaultMeta)})`}
            >
              Max
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy !== null || nativeBalance === null || nativeBalance === 0n}
              onClick={() => {
                // XLM pays the fees and the account's own reserve, so the most
                // that can be deposited is less than the balance on screen.
                const fill =
                  vaultMeta.symbol === "XLM"
                    ? maxDeposit(nativeBalance ?? 0n)
                    : (nativeBalance ?? 0n);
                setAmount(fromStroops(fill, vaultMeta.decimals, vaultMeta.decimals));
              }}
              aria-label="Fill the amount with the maximum spendable wallet balance"
              title={
                vaultMeta.symbol === "XLM"
                  ? tr("Fill max spendable balance (leaving the account reserve)")
                  : tr("Fill full wallet balance")
              }
            >
              Max wallet
            </button>
            <LoadingButton
              variant="primary"
              loading={busy === "deposit"}
              loadingText={tr("Depositing…")}
              disabled={busy !== null || networkMismatch}
              onClick={() =>
                void run("deposit", () =>
                  payflow.deposit(
                    address!,
                    signXdr,
                    config.contracts.token,
                    parseAmount(amount, vaultMeta.decimals),
                  ),
                )
              }
            >
              {tr("Deposit")}
            </LoadingButton>
            <LoadingButton
              variant="ghost"
              loading={busy === "withdraw"}
              loadingText={tr("Withdrawing…")}
              disabled={busy !== null || networkMismatch || !withdrawCheck.ok}
              onClick={() =>
                void run("withdraw", () =>
                  payflow.withdraw(
                    address!,
                    signXdr,
                    config.contracts.token,
                    parseAmount(amount, vaultMeta.decimals),
                  ),
                )
              }
            >
              {tr("Withdraw")}
            </LoadingButton>
          </div>
        </Panel>
      )}

      {!isReadOnly && address && fundSupport === true && (
        <Panel
          title={tr("Fund another account")}
          subtitle={tr("Send tokens to someone else's vault. Only the recipient can withdraw — you cannot cancel or refund the deposit.")}
        >
          {fundFor ? (
            <div className="space-y-3">
              <p className="text-sm">{tr("{0} pays {1} into the vault of {2}.", { 0: shortAddress(address), 1: formatAmount(fundStroops, vaultMeta), 2: shortAddress(fundFor) })}</p>
              <p className="mt-1 text-xs text-muted">{tr("Only")}{" "}
                <span className="font-mono truncate">{shortAddress(fundFor)}</span>{" "}{tr("can withdraw it — you cannot cancel or refund this deposit.")}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy !== null}
                  onClick={() => setFundFor(null)}
                >{tr("Cancel")}</button>
                <LoadingButton
                  variant="primary"
                  loading={busy === `fund-for-${fundFor}`}
                  loadingText={tr("Funding…")}
                  disabled={busy !== null || networkMismatch}
                  onClick={fundConfirmed}
                >
                  {tr("Fund")}
                </LoadingButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1">
                <label className="label" htmlFor="fund-recipient">{tr("Recipient address")}</label>
                <input
                  id="fund-recipient"
                  className="input"
                  placeholder={tr("GABC…")}
                  value={fundRecipient}
                  onChange={(e) => setFundRecipient(e.target.value)}
                  aria-invalid={Boolean(recipientDisplayError)}
                  aria-describedby={recipientDisplayError ? "fund-recipient-error" : undefined}
                  disabled={busy !== null}
                />
                {recipientDisplayError && (
                  <p id="fund-recipient-error" role="alert" className="mt-1 text-sm text-danger">
                    {translateMessage(recipientDisplayError)}
                  </p>
                )}
              </div>
              <div className="min-w-[12rem] flex-1">
                <AmountInput
                  id="fund-amount"
                  label={tr("Amount ({0})", { "0": vaultMeta.symbol })}
                  value={fundAmount}
                  onChange={setFundAmount}
                  decimals={vaultMeta.decimals}
                  placeholder="5.0"
                  disabled={busy !== null}
                />
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  busy !== null ||
                  networkMismatch ||
                  Boolean(recipientDisplayError) ||
                  !fundAmountCheck.ok
                }
                onClick={fundAnother}
              >
                {busy === "fund-another" ?tr("Funding…") :tr("Fund")}
              </button>
            </div>
          )}
        </Panel>
      )}

      <Panel
        title={tr("Vault history")}
        subtitle={tr("Deposits, withdrawals and debits behind your balance.")}
      >
        {history === null ? (
          <SkeletonRows rows={3} label={tr("Loading history")} />
        ) : history.length === 0 ? (
          indexerAvailable ? (
            <Empty
              title={tr("No vault activity yet")}
              action={
                !isReadOnly ? (
                  <a href="#amount" className="btn-primary">{tr("Make a deposit")}</a>
                ) : undefined
              }
            >{tr("Deposits, withdrawals and debit charges appear here as they settle. Fund the vault above so charges have a balance to draw from.")}</Empty>
          ) : null
        ) : (
          <div className="space-y-2">
            {history.map((event) => {
              const label = vaultEventLabel(event);
              const isCredit = vaultEventTone(event) === "ok";
              const eventAmount = `${isCredit ? "+" : "-"}${formatTokenValue(event.amount, 4, vaultMeta.decimals)}`;
              return (
                <div
                  key={event.tx_hash}
                  className="flex items-center justify-between gap-3 rounded-lg border border-edge p-3"
                  aria-label={tr("{0} {1} {2}, ledger {3}", { "0": tr(label), "1": eventAmount, "2": vaultMeta.symbol, "3": String(event.ledger) })}
                >
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-medium">{typeof label === "string" ? tr(label) : label}</span>
                    <span className="mono text-xs text-muted">{tr("tx")}</span>
                    <TxLink hash={event.tx_hash} />
                  </div>
                  <div className="text-end">
                    <Money
                      amount={isCredit ? event.amount : `-${event.amount}`}
                      meta={vaultMeta}
                      signDisplay="always"
                      tone="auto"
                    />
                    <div className="text-xs text-muted">{tr("ledger")}{" "}{event.ledger}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {history !== null && !indexerAvailable && (
          <Notice tone="info">{tr("Vault history is not available in contract-only mode. It requires the payflow-backend indexer (set NEXT_PUBLIC_API_URL). Deposits, withdrawals and debits still update your on-chain balance; only the event list is missing.")}</Notice>
        )}
      </Panel>

      <Panel
        title={tr("My subscriptions")}
        subtitle={tr("Add the next charge to your calendar, or export past payments for your records.")}
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost whitespace-nowrap"
              disabled={activeCount === 0}
              onClick={downloadCalendar}
              title={
                activeCount === 0
                  ?tr("No active subscriptions to add")
                  :tr("Download an .ics file for Google or Apple Calendar")
              }
            >{tr("Add to calendar")}</button>
            {/*
              Read-only, so it stays enabled on a mismatched network: exporting
              records does not need the wallet's network to match the app's.
              Disabled only when there is nothing it can honestly export.
            */}
            <button
              type="button"
              className="btn-ghost whitespace-nowrap"
              disabled={exporting || !mandatesFromApi || (mandates?.length ?? 0) === 0}
              onClick={() => void exportPayments()}
              aria-label={tr("Export my payments as CSV")}
              title={
                !mandatesFromApi
                  ?tr("Payment history needs the payflow indexer (set NEXT_PUBLIC_API_URL)")
                  : (mandates?.length ?? 0) === 0
                    ?tr("No subscriptions to export")
                    :tr("Download a CSV of every charge against your subscriptions")
              }
            >
              {exporting ?tr("Exporting…") :tr("Export CSV")}
            </button>
          </div>
        }
      >
        {!mandatesFromApi && mandates !== null && (
          <Notice tone="info">{tr("Payment history — and this CSV export — come from the payflow indexer, which is not reachable here, so the export is unavailable in contract-only mode. The chain records how many charges each mandate has taken, but not their amounts or transaction hashes. Set NEXT_PUBLIC_API_URL and rebuild to enable it; everything else on this page still works without a backend.")}</Notice>
        )}
        {mandates === null ? (
          <SkeletonRows rows={2} label={tr("Loading subscriptions")} />
        ) : mandates.length === 0 ? (
          <Empty
            title={tr("No subscriptions yet")}
            action={
              !isReadOnly ? (
                <Link href="/subscribe" className="btn-primary">{tr("Browse plans")}</Link>
              ) : undefined
            }
          >{tr("Subscribing to a plan opens a mandate, and every mandate shows up here with its next charge date. You can pause or cancel any of them from this page.")}</Empty>
        ) : (
          <div className="space-y-3">
            {!isReadOnly && (
              <p className="mt-3 text-xs text-muted">{tr("Browser reminders are opt-in per subscription and ask for notification permission only when you choose “Remind me”. While Payflow is open they fire a day before the charge; in browsers that support scheduled notifications the installed app can deliver them in the background. Reminders stop when a subscription is cancelled or completed.")}</p>
            )}
            {!isReadOnly && (
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy !== null || networkMismatch}
                  onClick={handleCancelAll}
                >
                  {busy !== null || networkMismatch ?tr("Cancelling…") :tr("Cancel all")}
                </button>
              </div>
            )}
            {subscriptionGroups
              .filter((group) => group.mandates.length > 0)
              .map((group) => (
                <section
                  key={group.key}
                  aria-labelledby={`subscription-group-${group.key}`}
                  className="space-y-3"
                >
                  <h3
                    id={`subscription-group-${group.key}`}
                    className="flex items-center gap-2 pt-2 text-sm font-semibold text-soft"
                  >
                    {subscriptionGroupTitles[group.key]}
                    <span className="sr-only">{" "}{tr("subscriptions")}</span>
                    <span className="rounded-full bg-fg/10 px-2 py-0.5 text-xs font-medium text-muted">
                      {formatNumber(group.mandates.length)}
                    </span>
                  </h3>
                  <VirtualList
                    items={group.mandates}
                    threshold={100}
                    itemHeight={180}
                    keyExtractor={(m) => m.id}
                    listAriaLabel={tr("{0} subscriptions", { "0": subscriptionGroupTitles[group.key] })}
                    className="space-y-3"
                    renderItem={(m) => {
                const terminal = m.status === "Cancelled" || m.status === "Completed";
                const meta = metaFor(metas, m.token ?? config.contracts.token);
                const resumeAt = mandatePauseUntil(m);
                const resumes = resumeDate(resumeAt) && resumeAt ? formatDate(resumeAt) : null;
                const pastDueUntil = mandatePastDueUntil(m);
                const isPastDue = mandateIsPastDue(m);
                const trial = describeTrialEnd(m);
                const discounted = nextChargeAmount(m);
                const badge = discountBadge(m);
                const remaining = remainingDiscountCharges(m);
                const pending = mandatePendingTransfer(m);
                // Both of these read from data the page already has, so the
                // timeline works in contract-only mode: the mandates may come
                // from chain state and the balance from a vault read.
                const schedule = buildChargeSchedule(m);
                const nextAmount = schedule.charges[0]?.amount;
                const sameToken =
                  (m.token ?? config.contracts.token) === config.contracts.token;
                const shortfall =
                  nextAmount === undefined || !sameToken
                    ? null
                    : chargeShortfall(balance, nextAmount);
                const pastDueShortfall =
                  isPastDue && sameToken && nextAmount !== undefined
                    ? chargeShortfall(balance, nextAmount)
                    : null;

                return (
                  <div key={m.id} className="rounded-lg border border-edge p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/mandates/?id=${m.id}`}
                            className="font-medium hover:underline text-soft focus:outline-none focus:ring-1 focus:ring-accent rounded"
                          >{tr("Mandate #")}{m.id}
                          </Link>
                          <Badge status={m.status} />
                          {isPastDue && (
                            <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">{tr("Past due")}</span>
                          )}
                          {resumes && (
                            <span className="text-xs text-muted">{tr("resumes")}{" "}{resumes}</span>
                          )}
                          {isPastDue && <GracePeriodBadge until={pastDueUntil} />}
                          {trial && (
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">{tr("Free trial")}</span>
                          )}
                          {badge && (
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                              {badge}
                            </span>
                          )}
                          {m.ended_by === "merchant" && (
                            <span className="text-xs text-muted">{tr("ended by the merchant")}</span>
                          )}
                          {pending && (
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                              Transfer pending
                            </span>
                          )}
                          {m.status === "Paused" && pausedBy.get(m.id) === "merchant" && (
                            <span className="text-xs text-muted">{tr("paused by the merchant")}</span>
                          )}
                        </div>
                        <div className="mt-1 text-sm text-muted">
                          {discounted !== null ? (
                            <>
                              <span className="font-medium text-fg">
                                <Money amount={discounted} meta={meta} digits={4} />
                              </span>{" "}
                              <span className="text-xs line-through">
                                <Money amount={m.amount} meta={meta} digits={4} />
                              </span>{" "}
                            </>
                          ) : (
                            <>
                              <Money amount={m.amount} meta={meta} digits={4} />{" "}
                            </>
                          )}
                          {formatPeriod(m.period)}{" "}{tr("· to")}{" "}<MerchantAccount value={m.merchant} />
                        </div>
                        {badge && (
                          <div className="mt-1 text-xs text-accent">
                            {discounted !== null ? (
                              <>{tr("You pay")}{" "}<Money amount={discounted} meta={meta} digits={4} />{" "}{tr("for the next charge")}{remaining === null
                                  ? "."
                                  : remaining === 1
                                    ?tr(", then the full price.")
                                    :tr(", then the full price. {0} discounted charges left.", { "0": remaining })}
                              </>
                            ) : remaining === 0 ? (
                              <>{tr("The discount has run out — you pay the full price now.")}</>
                            ) : (
                              <>{tr("The merchant set a discount on this subscription.")}</>
                            )}
                          </div>
                        )}
                        <div className="mt-1 text-xs text-muted">
                          {formatNumber(m.charges_made)}{" "}{tr("charge")}{m.charges_made === 1 ? "" :tr("s")}{" "}{tr("taken")}{m.max_charges > 0 &&tr(" of {0}", { "0": m.max_charges })}
                          {tr(" · next ")}
                          {m.status === "Active" ? <TimeAgo value={m.next_charge} /> : "—"}
                        </div>
                        {trial && (
                          <div className="mt-1 text-xs text-accent">
                            {trial}{tr(". Cancel before then and you pay nothing.")}</div>
                        )}
                        {mandateSupportsSpendLimit(m) && (
                          <div className="mt-1 text-xs text-accent">
                            {tr(spendLimitInfo())}
                          </div>
                        )}
                        {pending && (
                          <div className="mt-1 text-xs text-muted">
                            {pending === address ? (
                              <>This subscription is being transferred to this wallet. Accept it below to take it over.</>
                            ) : (
                              <>
                                Transfer to{" "}
                                <span className="font-mono truncate">{shortAddress(pending)}</span>{" "}
                                is pending. The receiving wallet must accept it.
                              </>
                            )}
                          </div>
                        )}
                        {isPastDue && pastDueShortfall !== null && (
                          <Notice tone="error">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="font-medium">{tr("This subscription is past due — your vault is short by")}{" "}
                                  <Money amount={pastDueShortfall} meta={meta} />{" "}{tr("for the next charge.")}</p>
                                {pastDueUntil && (
                                  <p className="mt-1 text-xs text-muted">{tr("The grace period ends")}{" "}{formatDate(pastDueUntil)}{tr(". After that, the mandate may expire if the charge cannot be settled.")}</p>
                                )}
                              </div>
                              {!isReadOnly && (
                                <button
                                  type="button"
                                  className="btn-primary whitespace-nowrap"
                                  disabled={busy !== null || networkMismatch}
                                  onClick={() =>
                                    void run(`deposit-past-due-${m.id}`, () =>
                                      payflow.deposit(
                                        address!,
                                        signXdr,
                                        config.contracts.token,
                                        parseAmount(
                                          formatTokenValue(pastDueShortfall + 1n, 4, meta.decimals),
                                          meta.decimals,
                                        ),
                                      ),
                                    )
                                  }
                                >
                                  {busy === `deposit-past-due-${m.id}` ?tr("Depositing…") :tr("Deposit to fix")}
                                </button>
                              )}
                            </div>
                          </Notice>
                        )}
                      </div>

                    {!terminal && !isReadOnly && (
                      <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-edge">
                        {/* Subscriber can pause, but cannot resume if paused by merchant */}
                        {m.status === "Active" && (
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy !== null || networkMismatch}
                            onClick={() =>
                              void run(`pause-${m.id}`, () =>
                                payflow.setPaused(
                                  address!,
                                  signXdr,
                                  m.id,
                                  true,
                                ),
                              )
                            }
                          >{tr("Pause")}</button>
                        )}
                        {/* Opting in is local and needs no network, so a
                            mismatched wallet network does not block it. */}
                        {reminderEligible(m) && (
                          <button
                            type="button"
                            className={`btn-ghost ${
                              hasReminder(reminderPrefs, m.id) ? "text-accent" : ""
                            }`}
                            disabled={reminderBusy === m.id}
                            aria-pressed={hasReminder(reminderPrefs, m.id)}
                            title={tr("Notify me a day before this subscription charges")}
                            onClick={() => void toggleReminder(m.id)}
                          >
                            {reminderBusy === m.id
                              ?tr("Saving…")
                              : hasReminder(reminderPrefs, m.id)
                                ?tr("Reminder on")
                                :tr("Remind me")}
                          </button>
                        )}
                        {m.status === "Paused" && pausedBy.get(m.id) !== "merchant" && (
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy !== null || networkMismatch}
                            onClick={() =>
                              void run(`pause-${m.id}`, () =>
                                payflow.setPaused(
                                  address!,
                                  signXdr,
                                  m.id,
                                  false,
                                ),
                              )
                            }
                          >{tr("Resume")}</button>
                        )}
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={busy !== null || networkMismatch}
                          onClick={() => openCapEditor(m)}
                        >
                          Edit cap
                        </button>

                        {/* Offered only against a contract that carries the
                            two-step transfer; see `transferAvailable`. */}
                        {transferAvailable &&
                          !pending &&
                          (transferFor === m.id ? null : (
                            <button
                              type="button"
                              className="btn-ghost"
                              disabled={busy !== null || networkMismatch}
                              onClick={() => openTransfer(m.id)}
                            >
                              Transfer…
                            </button>
                          ))}
                        {nextAmount !== undefined && !isPastDue && (
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy !== null || networkMismatch || shortfall !== null}
                            onClick={() =>
                              void run(`deposit-quick-${m.id}`, () =>
                                payflow.deposit(
                                  address!,
                                  signXdr,
                                  config.contracts.token,
                                  nextAmount!,
                                ),
                              )
                            }
                          >
                            {tr("Top up")}
                          </button>
                        )}
                        {/* Offered only against a contract that carries
                            pause_until; see `pauseSupported`. */}
                        {pauseSupported &&
                          (pauseFor === m.id ? (
                            <>
                              <label
                                className="sr-only"
                                htmlFor={`pause-until-${m.id}`}
                              >{tr("Resume date for mandate")}{" "}{m.id}
                              </label>
                              <input
                                id={`pause-until-${m.id}`}
                                type="date"
                                className="input"
                                min={minPauseDate()}
                                value={pauseDate}
                                disabled={busy !== null}
                                aria-invalid={pauseError !== null || undefined}
                                aria-describedby={pauseError ? `pause-until-error-${m.id}` : undefined}
                                onChange={(e) => {
                                  setPauseDate(e.target.value);
                                  setPauseError(null);
                                }}
                              />
                              <button
                                type="button"
                                className="btn-primary"
                                disabled={busy !== null || networkMismatch}
                                onClick={() => void pauseUntil(m.id)}
                              >
                                {busy === `pause-until-${m.id}`
                                  ?tr("Pausing…")
                                  :tr("Pause until…")}
                              </button>
                              <button
                                type="button"
                                className="btn-ghost"
                                disabled={busy !== null}
                                onClick={() => {
                                  setPauseFor(null);
                                  setPauseError(null);
                                }}
                              >{tr("Back")}</button>
                              {pauseError && (
                                <p
                                  id={`pause-until-error-${m.id}`}
                                  role="alert"
                                  className="w-full text-xs text-danger"
                                >
                                  {pauseError}
                                </p>
                              )}
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn-ghost"
                              disabled={busy !== null || networkMismatch}
                              onClick={() => openPausePicker(m.id)}
                            >{tr("Pause until…")}</button>
                          ))}
                        <button
                          type="button"
                          className="btn-ghost text-danger"
                          disabled={busy !== null || networkMismatch}
                          aria-label={tr("Cancel subscription #{0}", { "0": m.id })}
                          onClick={() => {
                            setError(null);
                            setConfirmCancel(m.id);
                          }}
                        >{tr("Cancel")}</button>
                        {confirmCancel === m.id && (
                          <ConfirmDialog
                            open
                            onCancel={() => setConfirmCancel(null)}
                            onConfirm={() =>
                              void run(`cancel-${m.id}`, () =>
                                payflow.cancel(address!, signXdr, m.id),
                              ).then((ok) => {
                                if (ok) setConfirmCancel(null);
                              })
                            }
                            title={confirmTitle(tr("Cancel subscription #{0}", { "0": m.id }))}
                            confirmLabel={tr("Confirm cancellation")}
                            cancelLabel={tr("Keep")}
                            busy={busy === `cancel-${m.id}`}
                            busyLabel={tr("Cancelling…")}
                            confirmDisabled={networkMismatch}
                            danger
                            error={error ?? undefined}
                          >
                            <p className="text-muted">
                              {tr("This subscription stops billing immediately. This cannot be undone.")}
                            </p>
                          </ConfirmDialog>
                        )}
                      </div>
                    )}

                    {transferAvailable && pending === address && (
                      <section
                        className="mt-4 border-t border-edge pt-3"
                        aria-labelledby={`accept-transfer-${m.id}`}
                      >
                        <h3 id={`accept-transfer-${m.id}`} className="text-sm font-medium">
                          Accept transfer
                        </h3>
                        <p className="mt-1 text-xs text-muted">
                          Another wallet is transferring this subscription to you.
                          Accepting makes it yours: future charges debit your vault,
                          so make sure it is funded.
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={busy !== null || networkMismatch}
                            onClick={() => void acceptTransfer(m.id)}
                          >
                            {busy === `accept-${m.id}` ? "Accepting…" : "Accept transfer"}
                          </button>
                        </div>
                      </section>
                    )}

                    {transferAvailable && transferFor === m.id && (
                      <section
                        className="mt-4 border-t border-edge pt-3"
                        aria-labelledby={`transfer-${m.id}`}
                      >
                        <h3 id={`transfer-${m.id}`} className="text-sm font-medium">
                          Transfer to a new wallet
                        </h3>
                        <p className="mt-1 text-xs text-muted">
                          The new wallet must accept the transfer before it takes
                          effect. Its vault must be funded — charges will debit it
                          once the transfer completes.
                        </p>
                        <div className="mt-2 flex flex-wrap items-end gap-3">
                          <div className="min-w-[14rem] flex-1">
                            <label className="label" htmlFor={`transfer-to-${m.id}`}>
                              New wallet address
                            </label>
                            <input
                              id={`transfer-to-${m.id}`}
                              className="input"
                              placeholder="GABC…"
                              value={transferTo}
                              onChange={(e) => setTransferTo(e.target.value)}
                              aria-invalid={Boolean(transferDisplayError)}
                              aria-describedby={
                                transferDisplayError ? `transfer-to-error-${m.id}` : undefined
                              }
                              disabled={busy !== null}
                            />
                            {transferDisplayError && (
                              <p
                                id={`transfer-to-error-${m.id}`}
                                role="alert"
                                className="mt-1 text-sm text-danger"
                              >
                                {transferDisplayError}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={
                              busy !== null ||
                              networkMismatch ||
                              Boolean(transferDisplayError) ||
                              !transferTo.trim()
                            }
                            onClick={() => void transferConfirmed(m.id)}
                          >
                            {busy === `transfer-${m.id}` ? "Transferring…" : "Transfer"}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy !== null}
                            onClick={() => {
                              setTransferFor(null);
                              setTransferTo("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </section>
                    )}
                  </div>
                  {capFor === m.id && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-edge pt-3">
                      <div className="min-w-[10rem] flex-1">
                        <div className="flex items-center gap-1">
                          <label
                            htmlFor={`cap-${m.id}`}
                            className="block text-xs text-muted"
                          >
                            Max charges (0 = unlimited)
                          </label>
                          <InfoTip label={tr("About the charge cap")}>
                            {tr("The mandate ends by itself once this many charges have been made. It cannot be set below the charges already made.")}
                          </InfoTip>
                        </div>
                        <input
                          id={`cap-${m.id}`}
                          type="text"
                          inputMode="numeric"
                          className="input mt-1 w-full"
                          value={capAmount}
                          onChange={(e) => {
                            setCapAmount(e.target.value);
                            setCapError(null);
                          }}
                          aria-invalid={capError !== null || undefined}
                          aria-describedby={capError ? `cap-error-${m.id}` : undefined}
                          disabled={busy !== null}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={busy !== null || networkMismatch}
                        onClick={() => submitCap(m)}
                      >
                        {busy === `cap-${m.id}` ? "Saving…" : "Save cap"}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={busy !== null}
                        onClick={() => {
                          setCapFor(null);
                          setCapError(null);
                        }}
                      >
                        Close
                      </button>
                      {capError && (
                        <p id={`cap-error-${m.id}`} className="w-full text-xs text-danger" role="alert">
                          {capError}
                        </p>
                      )}
                    </div>
                  )}

                    {schedule.charges.length > 0 && (
                      <section
                        className="mt-4 border-t border-edge pt-3"
                        aria-labelledby={`schedule-${m.id}`}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <h3 id={`schedule-${m.id}`} className="text-sm font-medium">{tr("Upcoming charges")}</h3>
                          <span className="text-xs text-muted">{tr("Next")}{" "}{formatNumber(schedule.charges.length)}{" "}{tr("total")}{" "}
                            <Money amount={schedule.total} meta={meta} />
                          </span>
                        </div>
                        <ol className="mt-2 space-y-1.5">
                          {schedule.charges.map((charge) => (
                            <li
                              key={charge.due}
                              className="flex items-baseline justify-between gap-3 text-sm"
                            >
                              <span className="text-muted">
                                <TimeAgo value={charge.due} />
                              </span>
                              <span className="tabular-nums">
                                <Money amount={charge.amount} meta={meta} />
                              </span>
                            </li>
                          ))}
                        </ol>
                        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted">
                          <span>{tr("Running total")}{" "}
                            <strong className="font-medium text-fg">
                              <Money amount={schedule.total} meta={meta} />
                            </strong>
                          </span>
                          {schedule.finalDate !== null && (
                            <span>{tr("Final charge")}{" "}<TimeAgo value={schedule.finalDate} /></span>
                          )}
                        </div>
                        {shortfall !== null && (
                          <p
                            role="status"
                            className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
                          >{tr("Your vault is short by")}{" "}<Money amount={shortfall} meta={meta} />{" "}{tr("for the next charge. Deposit before")}{" "}{formatDate(m.next_charge)}{" "}{tr("or it will fail.")}</p>
                        )}
                      </section>
                    )}
                  </div>
                );
              }}
                  />
                </section>
              ))}
          </div>
        )}
      </Panel>

      <PaymentHistoryPanel
        state={payments}
        onRetry={() => setPaymentsReload((value) => value + 1)}
      />

      <ConfirmDialog
        open={cancelAllTargets !== null}
        onCancel={() => setCancelAllTargets(null)}
        onConfirm={cancelAllConfirmed}
        title={tr("Cancel {0} subscription{1}?", {
          "0": cancelAllTargets?.length ?? 0,
          "1": (cancelAllTargets?.length ?? 0) === 1 ? "" : "s",
        })}
        confirmLabel={tr("Cancel subscriptions")}
        busy={busy === "cancel-all"}
        busyLabel={tr("Cancelling…")}
        confirmDisabled={networkMismatch}
        error={error ?? undefined}
        danger
      >
        <p className="text-muted">
          {tr("Every active or paused subscription listed below stops billing immediately. This cannot be undone.")}
        </p>
      </ConfirmDialog>
    </div>
  );
}

function spendLimitInfo(): string {
  // Spend limit read requires an RPC call; defer to useEffect later.
  return "Spend limit: loading";
}

export default function AccountPage() {
  const { t: tr } = useI18n();
  return (
    <Suspense fallback={<SkeletonRows rows={3} label={tr("Loading account")} />}>
      <AccountInner />
    </Suspense>
  );
}