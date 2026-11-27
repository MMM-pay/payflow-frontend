"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import {
  checkIndexer,
  checkKeeper,
  checkRpc,
  overallState,
  stateLabel,
  type CheckState,
  type IndexerCheck,
  type KeeperCheck,
  type RpcCheck,
} from "@/lib/status";
import { Notice, Panel, TimeAgo } from "@/components/ui";

/**
 * One row per check inside a panel: label on the left, value on the right,
 * stacking at phone widths.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

const STATE_STYLES: Record<CheckState, string> = {
  ok: "border-accent/40 bg-accent/10 text-accent",
  degraded: "border-warn/40 bg-warn/10 text-warn",
  down: "border-danger/40 bg-danger/10 text-danger",
  skipped: "border-edge bg-fg/5 text-muted",
};

/** A text-labelled badge; the state is never carried by colour alone. */
function StateBadge({ state }: { state: CheckState }) {
  const { t: tr } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATE_STYLES[state]}`}
    >
      {tr(stateLabel(state))}
    </span>
  );
}

export default function StatusPage() {
  const { t: tr, translateMessage, formatExactTime } = useI18n();
  const [rpc, setRpc] = useState<RpcCheck | null>(null);
  const [indexer, setIndexer] = useState<IndexerCheck | null>(null);
  const [keeper, setKeeper] = useState<KeeperCheck | null>(null);
  // Whether the backend URL was present at load, so the page can explain
  // "skipped" without a second round-trip.
  const [backendConfigured] = useState(() => api.isConfigured());

  /**
   * Each check runs and settles on its own state — there is no shared
   * promise, so a hung RPC cannot delay the API card and a dead backend
   * cannot blank the RPC card. That independence is the acceptance
   * criterion for this page.
   */
  const load = useCallback(async () => {
    setRpc(null);
    setIndexer(null);
    setKeeper(null);
    void checkRpc().then(setRpc);
    void checkIndexer().then(setIndexer);
    void checkKeeper().then(setKeeper);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const overall = overallState(
    [rpc, indexer, keeper].filter((c): c is NonNullable<typeof c> => c !== null),
  );
  // Only claim an overall verdict once every check has answered; a partial
  // page that says "Operational" before the slow card lands would lie.
  const settled = rpc !== null && indexer !== null && keeper !== null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{tr("Service status")}</h1>
          <p className="max-w-2xl text-muted">
            {tr("Each check below runs in your browser and fails on its own, so one outage never hides the others. Contract reads and writes go straight to Soroban RPC and keep working even when the indexer and keeper are down.")}
          </p>
        </div>
        <button type="button" onClick={load} className="btn-ghost shrink-0">
          {tr("Re-check")}
        </button>
      </header>

      {settled && (
        <Notice tone={overall === "ok" ? "ok" : overall === "down" ? "error" : "info"}>
          {tr("Overall: {0}.", { "0": tr(stateLabel(overall)).toLowerCase() })}
          {overall === "down" &&
            ` ${tr("Some dependency is not answering — the cards below say which.")}`}
          {overall === "degraded" &&
            ` ${tr("Everything answers, but something is behind or has nothing to report.")}`}
          {overall === "skipped" &&
            ` ${tr("This deployment runs without a backend, so only the RPC check applies.")}`}
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={tr("Soroban RPC")}>
          <div role="status" aria-busy={rpc === null || undefined} className="space-y-3">
            {rpc === null ? (
              <p className="text-sm text-muted">{tr("Checking RPC…")}</p>
            ) : (
              <>
                <StateBadge state={rpc.state} />
                {rpc.state === "ok" ? (
                  <dl className="divide-y divide-edge/50">
                    <Row label={tr("Latest ledger")}>{rpc.latestLedger}</Row>
                    <Row label={tr("Endpoint")}>
                      <span className="mono text-xs break-all">{config.rpcUrl}</span>
                    </Row>
                  </dl>
                ) : (
                  <Notice tone="error">{rpc.error}</Notice>
                )}
                {rpc.state !== "ok" && (
                  <p className="text-sm text-muted">
                    {tr("Contract reads and writes need this endpoint. Lists fall back to the contract-only path and still work.")}
                  </p>
                )}
              </>
            )}
          </div>
        </Panel>

        <Panel title={tr("Indexer API")}>
          <div role="status" aria-busy={indexer === null || undefined} className="space-y-3">
            {indexer === null ? (
              <p className="text-sm text-muted">{tr("Checking backend…")}</p>
            ) : (
              <>
                <StateBadge state={indexer.state} />
                {indexer.state === "skipped" ? (
                  <p className="text-sm text-muted">
                    {backendConfigured
                      ? tr("The backend does not serve /health.")
                      : tr("No NEXT_PUBLIC_API_URL in this build — contract-only mode. Lists are read from contract state instead.")}
                  </p>
                ) : indexer.state === "down" ? (
                  <Notice tone="error">
                    {indexer.error ? translateMessage(indexer.error) : ""}{" "}
                    {tr("Lists fall back to reading contract state, which is slower but always correct.")}
                  </Notice>
                ) : (
                  <dl className="divide-y divide-edge/50">
                    <Row label={tr("Status")}>{indexer.status}</Row>
                    <Row label={tr("Ledger lag")}>
                      {indexer.lag === null ? "—" : tr("{0} ledgers", { "0": String(indexer.lag) })}
                    </Row>
                    <Row label={tr("Indexed through ledger")}>{indexer.cursor ?? "—"}</Row>
                    <Row label={tr("Indexer freshness")}>
                      {indexer.freshnessSeconds === null ? "—" : tr("{0}s ago", { "0": indexer.freshnessSeconds })}
                    </Row>
                    {indexer.network && <Row label={tr("Network")}>{indexer.network}</Row>}
                    {indexer.paused && (
                      <Row label={tr("Paused")}>
                        <span className="text-warn">{tr("indexing paused by an operator")}</span>
                      </Row>
                    )}
                  </dl>
                )}
                {indexer.state === "ok" && indexer.lastError && (
                  <p className="text-sm text-warn">
                    {tr("Last indexing error: {0}", { "0": translateMessage(indexer.lastError) })}
                  </p>
                )}
              </>
            )}
          </div>
        </Panel>

        <Panel title={tr("Settlement keeper")}>
          <div role="status" aria-busy={keeper === null || undefined} className="space-y-3">
            {keeper === null ? (
              <p className="text-sm text-muted">{tr("Checking keeper…")}</p>
            ) : (
              <>
                <StateBadge state={keeper.state} />
                {keeper.state === "skipped" ? (
                  <p className="text-sm text-muted">
                    {backendConfigured
                      ? tr("The backend does not serve keeper history — the keeper is probably off. Charging is permissionless: a merchant or subscriber can still settle a due mandate themselves.")
                      : tr("No backend in this build, so keeper history is unavailable. Charging is permissionless — anyone can settle a due mandate.")}
                  </p>
                ) : keeper.state === "degraded" && keeper.lastRunAt === null ? (
                  <p className="text-sm text-muted">{keeper.error ? translateMessage(keeper.error) : ""}</p>
                ) : (
                  <>
                    <dl className="divide-y divide-edge/50">
                      <Row label={tr("Last pass")}>
                        {keeper.lastRunAt === null ? (
                          "—"
                        ) : (
                          <TimeAgo value={keeper.lastRunAt} />
                        )}
                      </Row>
                      <Row label={tr("Tried / settled")}>
                        {keeper.attempted ?? "—"} / {keeper.settled ?? "—"}
                      </Row>
                      <Row label={tr("Failures in last pass")}>
                        {keeper.failureCount === null ? "—" : keeper.failureCount}
                      </Row>
                    </dl>
                    {keeper.failureCount !== null && keeper.failureCount > 0 && (
                      <p className="text-sm text-muted">
                        {tr("A failed pass retries with backoff; due mandates stay chargeable by hand in the meantime.")}
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
