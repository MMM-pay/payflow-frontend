"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type ProtocolStats } from "@/lib/api";
import { config } from "@/lib/config";
import { AddressLink, Panel, Stat } from "@/components/ui";

const STEPS = [
  {
    title: "The merchant publishes a plan",
    body: "Price, billing period, and token are written to the plan registry. The plan is public and immutable except for an on/off switch.",
  },
  {
    title: "The subscriber funds a vault and opens a mandate",
    body: "One signature. The plan's terms are copied into the mandate, so the merchant can never reprice it afterwards.",
  },
  {
    title: "Anyone settles the charge when it comes due",
    body: "The mandate is the authorization, so charging is permissionless. If our keeper stops, the merchant or the subscriber can still settle.",
  },
  {
    title: "The subscriber can leave at any time",
    body: "Cancel is unilateral and immediate. Withdrawing from the vault starves the mandate. Funds are never locked.",
  },
];

export default function HomePage() {
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void api.stats().then((s) => {
      setStats(s);
      setLoaded(true);
    });
  }, []);

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Recurring payments that Stellar could not do before.
        </h1>
        <p className="max-w-2xl text-muted">
          Stellar payments are push-only: the account holding the funds must sign every
          transfer. That makes one-off payments simple and subscriptions impossible without
          custody. Payflow adds the missing primitive — a bounded, revocable{" "}
          <strong className="text-soft">mandate</strong> the subscriber signs once.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link href="/subscribe" className="btn-primary">
            Browse plans
          </Link>
          <Link href="/merchant" className="btn-ghost">
            I&apos;m a merchant
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Plans" value={loaded ? (stats?.plans ?? "—") : "…"} />
        <Stat label="Mandates" value={loaded ? (stats?.mandates ?? "—") : "…"} />
        <Stat
          label="Active"
          value={loaded ? (stats?.activeMandates ?? "—") : "…"}
          hint="currently billable"
        />
        <Stat
          label="Charges settled"
          value={loaded ? (stats?.charges ?? "—") : "…"}
          hint={stats ? `ledger ${stats.lastIndexedLedger}` : "indexer offline"}
        />
      </section>

      {loaded && !stats && (
        <p className="text-sm text-muted">
          The indexer is unreachable, so these counters are blank. Everything else on this
          site reads contract state directly and still works.
        </p>
      )}

      <Panel title="How it works">
        <ol className="space-y-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-edge text-xs text-muted">
                {i + 1}
              </span>
              <div>
                <h3 className="text-sm font-medium">{step.title}</h3>
                <p className="mt-1 text-sm text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Deployed contracts" subtitle="Stellar testnet">
        <dl className="space-y-3 text-sm">
          {[
            ["Plan registry", config.contracts.planRegistry],
            ["Vault", config.contracts.vault],
            ["Subscription", config.contracts.subscription],
          ].map(([label, id]) => (
            <div key={label} className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-muted">{label}</dt>
              <dd>{id ? <AddressLink value={id} kind="contract" /> : <span className="text-muted">not configured</span>}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
