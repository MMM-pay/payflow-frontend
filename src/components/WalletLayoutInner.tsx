"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

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
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  // Navigate to a new page: the menu is no longer needed.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While open, move focus into the menu and let Escape close it. Escape
  // returns focus to the toggle so a keyboard user does not lose their place.
  useEffect(() => {
    if (!open) return;

    const firstLink = menuRef.current?.querySelector<HTMLAnchorElement>("a");
    firstLink?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        toggleRef.current?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

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
        <header className="border-b border-edge py-4 sm:py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-6">
              <Link href="/" className="shrink-0 text-lg font-semibold tracking-tight">
                Pay<span className="text-accent">flow</span>
              </Link>
              <nav className="hidden gap-4 text-sm text-muted md:flex" aria-label="Main navigation">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                    className={`hover:text-slate-100 ${
                      isCurrent(pathname, item.href) ? "text-slate-100" : ""
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <WalletButton />
              <button
                ref={toggleRef}
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-controls="mobile-nav"
                aria-label={open ? "Close menu" : "Open menu"}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-edge text-muted transition hover:border-muted hover:bg-white/5 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden"
              >
                {open ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path d="M4 7h16M4 12h16M4 17h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <nav
            id="mobile-nav"
            ref={menuRef}
            aria-label="Main navigation"
            hidden={!open}
            className="mt-3 border-t border-edge pt-3 md:hidden"
          >
            <ul className="space-y-1">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                    className={`block rounded-lg px-2 py-2.5 text-sm text-muted hover:bg-white/5 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                      isCurrent(pathname, item.href) ? "bg-white/5 text-slate-100" : ""
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
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
