"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/i18n/provider";
import { api, type ApiPlan } from "@/lib/api";
import { chainPlans } from "@/lib/chain";
import { config } from "@/lib/config";
import { payflow } from "@/lib/payflow";
import { useWallet } from "@/lib/wallet";
import { metaFor } from "@/lib/token";
import type { TokenMeta } from "@/lib/format";
import { planAvailability } from "@/lib/availability";
import { TxLink } from "@/components/ui";

export function SubscribeCardFlow({
  plan,
  metas,
  now,
}: {
  plan: ApiPlan;
  metas: Map<string, TokenMeta>;
  now: number;
}) {
  const { t: tr, formatAmount } = useI18n();
  const { address, networkMismatch, signXdr } = useWallet();

  const [vaultBalance, setVaultBalance] = useState<bigint | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [maxChargesInput, setMaxChargesInput] = useState("");
  const [busyStep, setBusyStep] = useState<"deposit" | "subscribe" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [depositHash, setDepositHash] = useState<string | null>(null);
  const [subscribeHash, setSubscribeHash] = useState<string | null>(null);

  const tokenContract = plan.token || config.contracts.token;
  const meta = metaFor(metas, tokenContract);

  const amountBig = BigInt(plan.amount ?? 0n);
  // Suggest price * cap or 3 periods (default 3 periods = amount * 3)
  const suggestedDeposit = amountBig * 3n;

  const loadBalance = useCallback(async () => {
    if (!address) {
      setVaultBalance(null);
      return;
    }
    setLoadingBalance(true);
    try {
      const bal = await payflow.vaultBalance(address, address, tokenContract);
      setVaultBalance(bal);
    } catch {
      setVaultBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }, [address, tokenContract]);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  const isFunded = vaultBalance !== null && vaultBalance >= amountBig;

  async function handleDeposit() {
    if (!address) {
      setError(tr("Connect a wallet first."));
      return;
    }
    if (networkMismatch) {
      setError(tr("Switch your wallet to the correct network first."));
      return;
    }
    setBusyStep("deposit");
    setError(null);
    setDepositHash(null);
    try {
      const hash = await payflow.deposit(address, signXdr, tokenContract, suggestedDeposit);
      setDepositHash(hash);
      await loadBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyStep(null);
    }
  }

  async function handleSubscribe() {
    if (!address) {
      setError(tr("Connect a wallet first."));
      return;
    }
    if (networkMismatch) {
      setError(tr("Switch your wallet to the correct network first."));
      return;
    }
    const limit = Number(maxChargesInput.trim()) || 0;
    if (!Number.isInteger(limit) || limit < 0) {
      setError(tr("Charge limit must be a whole number, or 0 for open-ended."));
      return;
    }
    setBusyStep("subscribe");
    setError(null);
    setSubscribeHash(null);
    try {
      const res = await api.plans();
      const plansList = res ? res.plans : await chainPlans(address);
      const latest = plansList.find((p) => p.id === plan.id);
      if (!latest || latest.active !== 1) {
        throw new Error(tr("This plan is no longer available."));
      }
      const hash = await payflow.subscribe(
        address,
        signXdr,
        plan.id,
        limit
      );
      setSubscribeHash(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyStep(null);
    }
  }

  const unavailable = plan.active !== 1
    ? "This plan is closed to new subscriptions."
    : planAvailability(plan, now).reason;

  if (unavailable) {
    return (
      <div className="mt-3 text-xs text-muted">
        {tr(unavailable)}
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-edge/80 p-3 bg-fg/[0.02]">
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        <span>{tr("Subscription Flow")}</span>
        {address && !loadingBalance && (
          <span>
            {tr("Vault Balance:")} <strong className="tabular-nums text-fg">{formatAmount(vaultBalance ?? 0n, meta)}</strong>
          </span>
        )}
      </div>

      {error && (
        <div className="rounded bg-danger/10 p-2 text-xs text-danger">
          {error}
        </div>
      )}

      {!isFunded && (
        <div className="space-y-2 rounded border border-edge p-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">
              {tr("Step 1: Fund Vault")}
            </span>
            <span className="text-muted">
              {tr("Suggested: {0}", { 0: formatAmount(suggestedDeposit, meta) })}
            </span>
          </div>
          <p className="text-xs text-muted">
            {tr("Your vault needs at least one period's payment to prevent immediate past-due status.")}
          </p>
          {depositHash ? (
            <div className="text-xs text-accent">
              {tr("Deposit successful!")} <TxLink hash={depositHash} />
            </div>
          ) : (
            <button
              type="button"
              className="btn-primary w-full text-xs py-1.5"
              onClick={() => void handleDeposit()}
              disabled={busyStep !== null}
            >
              {busyStep === "deposit" ? tr("Depositing…") : tr("Fund Vault ({0})", { 0: formatAmount(suggestedDeposit, meta) })}
            </button>
          )}
        </div>
      )}

      <div className="space-y-2 rounded border border-edge p-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">
            {isFunded ? tr("Step 1: Subscribe") : tr("Step 2: Subscribe")}
          </span>
        </div>
        <div>
          <label className="block text-[11px] text-muted mb-1" htmlFor={`max-charges-${plan.id}`}>
            {tr("Max charges (0 for open-ended)")}
          </label>
          <input
            id={`max-charges-${plan.id}`}
            type="number"
            min="0"
            step="1"
            className="input text-xs h-8"
            value={maxChargesInput}
            onChange={(e) => setMaxChargesInput(e.target.value)}
            placeholder="0"
            disabled={busyStep !== null}
          />
        </div>
        {subscribeHash ? (
          <div className="text-xs text-accent">
            {tr("Subscribed successfully!")} <TxLink hash={subscribeHash} />
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary w-full text-xs py-1.5"
            onClick={() => void handleSubscribe()}
            disabled={busyStep !== null || (!isFunded && !depositHash)}
          >
            {busyStep === "subscribe" ? tr("Subscribing…") : tr("Open Mandate")}
          </button>
        )}
      </div>
    </div>
  );
}
