"use client";

import { useI18n } from "@/i18n/provider";
import { RECOMMENDED_WALLETS } from "@/lib/wallet-detect";

/**
 * Shown when the browser has no Stellar wallet extension. Says what is
 * missing and where to get one, and what to do afterwards, because a wallet
 * installed in another tab is not seen until the page is reloaded.
 */
export function NoWalletNotice({ onDismiss }: { onDismiss?: () => void }) {
  const { t: tr } = useI18n();
  return (
    <div
      role="status"
      data-testid="no-wallet-notice"
      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn"
    >
      <div className="min-w-0 flex-1">
        <p>
          <strong>{tr("No Stellar wallet found.")}</strong>{" "}
          {tr("Payflow needs a wallet to sign payments. Install one, then reload this page.")}
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {RECOMMENDED_WALLETS.map((wallet) => (
            <li key={wallet.name}>
              <a
                href={wallet.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {tr("Get {0}", { "0": wallet.name })}
                <span className="sr-only"> {tr("(opens in a new tab)")}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="btn-ghost"
          aria-label={tr("Dismiss wallet notice")}
        >
          {tr("Dismiss")}
        </button>
      )}
    </div>
  );
}
