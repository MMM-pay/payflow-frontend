"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/provider";

import { useWallet } from "@/lib/wallet";
import { config } from "@/lib/config";
import { copyToClipboard } from "@/lib/clipboard";
import { fromStroops, shortAddress, spendableBalance } from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * The header's wallet control: the connected address, what it can spend, and a
 * way out of the dead end a brand new testnet account is in.
 */
export function WalletButton() {
  const { t: tr, translateMessage } = useI18n();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const {
    address,
    connecting,
    reconnecting = false,
    rememberedWalletId = null,
    walletSelectionLoaded = true,
    error,
    reconnectError = null,
    connect,
    disconnect,
    reconnect,
    account,
    funding,
    fund,
  } = useWallet();

  if (!address) {
    if (!walletSelectionLoaded) {
      return (
        <span role="status" aria-live="polite" className="text-xs text-muted">
          {tr("Checking saved wallet…")}
        </span>
      );
    }
    if (rememberedWalletId) {
      return (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {reconnecting && (
            <span role="status" aria-live="polite" aria-busy="true" className="text-xs text-muted">
              {tr("Reconnecting…")}
            </span>
          )}
          {!reconnecting && (reconnectError || error) && (
            <span role="alert" className="text-xs text-danger">
              {translateMessage(reconnectError ?? error ?? "")}
            </span>
          )}
          <button
            type="button"
            onClick={() => void reconnect()}
            disabled={connecting || reconnecting}
            aria-busy={connecting || reconnecting || undefined}
            className="btn-primary"
          >
            {connecting || reconnecting ? tr("Reconnecting…") : tr("Reconnect {0}", { "0": rememberedWalletId })}
          </button>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={connecting || reconnecting}
            className="btn-ghost"
            aria-label={tr("Choose another wallet")}
          >
            {tr("Choose another wallet")}
          </button>
        </div>
      );
    }
    if (!reconnecting && !reconnectError && !error) {
      return (
        <button
          type="button"
          onClick={() => void connect()}
          disabled={connecting || reconnecting}
          aria-busy={connecting || reconnecting || undefined}
          className="btn-primary"
        >
          {connecting || reconnecting ? tr("Reconnecting…") : tr("Connect wallet")}
        </button>
      );
    }
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {reconnecting && (
          <span
            role="status"
            aria-live="polite"
            aria-busy="true"
            className="inline-flex items-center gap-1.5 text-xs text-muted"
          >
            <span
              className="h-2 w-2 rounded-full bg-warn motion-safe:animate-pulse"
              aria-hidden="true"
            />
            {tr("Reconnecting…")}
          </span>
        )}
        {!reconnecting && (reconnectError || error) && (
          <span role="alert" className="text-xs text-danger" title={reconnectError ?? error ?? undefined}>
            {translateMessage(reconnectError ?? error ?? "")}
          </span>
        )}
        {!reconnecting && reconnectError && reconnect && (
          <button
            type="button"
            onClick={() => void reconnect()}
            className="btn-ghost text-xs"
            aria-label={tr("Reconnect wallet session")}
          >
            {tr("Reconnect")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void connect()}
          disabled={connecting || reconnecting}
          aria-busy={connecting || reconnecting || undefined}
          className="btn-primary"
        >
          {connecting ? tr("Connecting…") : reconnecting ? tr("Reconnecting…") : tr("Connect wallet")}
        </button>
      </div>
    );
  }

  return (
    // Wraps rather than overflows: at 375px the header has room for the
    // address and one short control, and an overflowing cluster would push
    // the logo off the screen.
    <div className="flex flex-wrap items-center justify-end gap-2">
      {reconnecting ? (
        <span
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="inline-flex items-center gap-1.5 text-xs text-muted"
        >
          <span
            className="h-2 w-2 rounded-full bg-warn motion-safe:animate-pulse"
            aria-hidden="true"
          />
          {tr("Reconnecting…")}
        </span>
      ) : reconnectError ? (
        <>
          <span role="alert" className="text-xs text-warn" title={reconnectError}>
            {tr("Session needs reconnect")}
          </span>
          {reconnect && (
            <button
              type="button"
              onClick={() => void reconnect()}
              className="btn-ghost text-xs"
              aria-label={tr("Reconnect wallet session")}
            >
              {tr("Reconnect")}
            </button>
          )}
        </>
      ) : (
        account && <BalanceLabel account={account} />
      )}
      <button
        type="button"
        onClick={async () => {
          setCopyState(await copyToClipboard(address) ? "copied" : "error");
        }}
        className="btn-ghost mono"
        title={address}
        aria-label={tr("Copy connected wallet address")}
      >
        <span>{shortAddress(address, 5)}</span>
      </button>
      <button
        type="button"
        onClick={() => void disconnect()}
        className="btn-ghost"
        aria-label={tr("Disconnect")}
      >
        {tr("Disconnect")}
      </button>
      {copyState !== "idle" && (
        <span role="status" aria-live="polite" className={copyState === "error" ? "text-xs text-danger" : "text-xs text-muted"}>
          {copyState === "copied" ? tr("Wallet address copied") : tr("Could not copy the wallet address")}
          {copyState === "copied" && <span className="sr-only"> {tr("Copied!")}</span>}
        </span>
      )}
      {/* Friendbot is a testnet faucet; off testnet there is nothing to offer. */}
      {account?.state === "missing" && config.friendbotUrl && (
        <button
          type="button"
          onClick={() => void fund()}
          disabled={funding}
          className="btn-primary"
          aria-label={tr("Fund with Friendbot")}
          title={tr("This account does not exist on testnet yet. Friendbot will create it and give it 10,000 test XLM.")}
        >
          {funding ? (
            tr("Funding…")
          ) : (
            <>
              <span aria-hidden="true" className="sm:hidden">
                {tr("Fund")}
              </span>
              <span aria-hidden="true" className="hidden sm:inline">
                {tr("Fund with Friendbot")}
              </span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * The spendable native balance.
 *
 * Says nothing while loading rather than flashing "0", because a wrong zero
 * reads as "you are broke" and sends people to the wrong page.
 */
function BalanceLabel({
  account,
}: {
  account: ReturnType<typeof useWallet>["account"];
}) {
  const { t: tr } = useI18n();
  if (account.state === "loading") {
    return (
      <span className="text-xs text-muted tabular-nums" aria-live="polite">
        {tr("Reading balance…")}
      </span>
    );
  }
  if (account.state === "error") {
    return (
      <span className="text-xs text-warn" title={account.message}>
        {tr("Balance unavailable")}
      </span>
    );
  }
  if (account.state === "missing") {
    // The Fund button next to this says the same thing, so the label is only
    // worth the width where there is room for both.
    return (
      <span className="hidden text-xs text-warn sm:inline" aria-hidden="true">
        {tr("Account not funded")}
      </span>
    );
  }

  const { balance, subentryCount } = account.account;
  const spendable = spendableBalance(balance, subentryCount);
  const balanceTitle =
    subentryCount === 1
      ? tr("{0} XLM held, {1} XLM spendable after the {2} ledger entry this account keeps", {
          "0": fromStroops(balance),
          "1": fromStroops(spendable),
          "2": subentryCount,
        })
      : tr("{0} XLM held, {1} XLM spendable after the {2} ledger entries this account keeps", {
          "0": fromStroops(balance),
          "1": fromStroops(spendable),
          "2": subentryCount,
        });
  return (
    <span
      className="whitespace-nowrap text-xs text-muted tabular-nums"
      // Announced so a screen-reader user hears the balance change after a
      // transaction without having to go looking for it.
      aria-live="polite"
      title={balanceTitle}
    >
      {fromStroops(spendable)} {tr("XLM")}
    </span>
  );
}