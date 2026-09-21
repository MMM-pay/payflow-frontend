"use client";

import Link from "next/link";
import { WalletButton } from "@/components/WalletButton";
import { NetworkMismatchBanner } from "@/components/ui";
import { config } from "@/lib/config";
import { useWallet } from "@/lib/wallet";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/subscribe", label: "Subscribe" },
  { href: "/account", label: "My account" },
  { href: "/merchant", label: "Merchant" },
];

/**
 * The visible app shell: header, nav, footer, and the global network
 * mismatch banner.
 *
 * Lives in its own file because it calls the `useWallet` hook, which only
 * works inside a client component. `src/app/layout.tsx` stays a server
 * component so it can keep exporting `metadata`.
 */
export function WalletLayoutInner({ children }: { children: React.ReactNode }) {
  const { networkMismatch, walletNetwork } = useWallet();
  return (
    <>
      {networkMismatch && (
        <div className="mx-auto max-w-5xl px-5 pt-4">
          <NetworkMismatchBanner
            walletNetwork={walletNetwork}
            expectedNetwork={config.networkPassphrase}
          />
        </div>
      )}
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-5">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-edge py-5">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Pay<span className="text-accent">flow</span>
            </Link>
            <nav className="flex gap-4 text-sm text-muted">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-slate-100">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <WalletButton />
        </header>

        <main className="flex-1 py-8">{children}</main>

        <footer className="border-t border-edge py-6 text-xs text-muted">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Stellar testnet · unaudited · do not use with real funds</span>
            <a
              href="https://github.com/MMM-pay"
              target="_blank"
              rel="noreferrer"
              className="hover:text-slate-200"
            >
              GitHub
            </a>
          </div>
        </footer>
      </div>
    </>
  );
}
