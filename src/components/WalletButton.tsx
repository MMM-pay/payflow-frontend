"use client";

import { useI18n } from "@/i18n/provider";

import { useWallet } from "@/lib/wallet";
import { config } from "@/lib/config";
import { fromStroops, shortAddress, spendableBalance } from "@/lib/format";

/**
 * The header's wallet control: the connected address, what it can spend, and a
 * way out of the dead end a brand new testnet account is in.
 */
export function WalletButton() {
  const { t: tr } = useI18n();
  const { address, connecting, connect, disconnect, account, funding, fund } =
    useWallet();

  if (!address) {
    return (
      <button
        type="button"
        onClick={() => void connect()}
        disabled={connecting}
        className="btn-primary"
      >
        {connecting ? tr("Connecting…") : tr("Connect wallet")}
      </button>
    );
  }

  return (
    // Wraps rather than overflows: at 375px the header has room for the
    // address and one short control, and an overflowing cluster would push
    // the logo off the screen.
    <div className="flex flex-wrap items-center justify-end gap-2">
      <BalanceLabel account={account} />
      <button
        type="button"
        onClick={() => void disconnect()}
        className="btn-ghost mono"
        title={tr("{0} — click to disconnect", { "0": address })}
      >
        <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
        {shortAddress(address, 5)}
      </button>
      {/* Friendbot is a testnet faucet; off testnet there is nothing to offer. */}
      {account.state === "missing" && config.friendbotUrl && (
        <button
          type="button"
          onClick={() => void fund()}
          disabled={funding}
          className="btn-primary"
          aria-label="Fund with Friendbot"
          title="This account does not exist on testnet yet. Friendbot will create it and give it 10,000 test XLM."
        >
          {funding ? (
            "Funding…"
          ) : (
            <>
              <span aria-hidden="true" className="sm:hidden">
                Fund
              </span>
              <span aria-hidden="true" className="hidden sm:inline">
                Fund with Friendbot
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
  if (account.state === "loading") {
    return (
      <span className="text-xs text-muted tabular-nums" aria-live="polite">
        Reading balance…
      </span>
    );
  }
  if (account.state === "error") {
    return (
      <span className="text-xs text-amber-300" title={account.message}>
        Balance unavailable
      </span>
    );
  }
  if (account.state === "missing") {
    // The Fund button next to this says the same thing, so the label is only
    // worth the width where there is room for both.
    return (
      <span className="hidden text-xs text-amber-300 sm:inline" aria-hidden="true">
        Account not funded
      </span>
    );
  }

  const { balance, subentryCount } = account.account;
  const spendable = spendableBalance(balance, subentryCount);
  return (
    <span
      className="whitespace-nowrap text-xs text-muted tabular-nums"
      // Announced so a screen-reader user hears the balance change after a
      // transaction without having to go looking for it.
      aria-live="polite"
      title={`${fromStroops(balance)} XLM held, ${fromStroops(spendable)} XLM spendable after the ${subentryCount} ledger ${subentryCount === 1 ? "entry" : "entries"} this account keeps`}
    >
      {fromStroops(spendable)} XLM
    </span>
  );
}
