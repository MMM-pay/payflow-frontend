import type { Metadata } from "next";
import "./globals.css";
import { I18nProvider } from "@/i18n/provider";
import { WalletProvider } from "@/lib/wallet";
import { WalletLayoutInner } from "@/components/WalletLayoutInner";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
// The Content-Security-Policy is injected into the static export after the
// build by scripts/apply-csp.mjs. Rendering it here would put the policy (and
// the hash list computed from the inline RSC payload) inside that same payload.

export const metadata: Metadata = {
  title: "Payflow — recurring payments on Stellar",
  description:
    "Pull-based recurring payments for Stellar. Subscribers authorize a bounded, revocable mandate once; anyone can settle it when it falls due.",
  manifest: `${basePath}/manifest.webmanifest`,
  icons: {
    icon: `${basePath}/icon-192.png`,
    apple: `${basePath}/icon-192.png`,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The inline script below sets `data-theme` on this element before the
    // first paint, so the server markup (no attribute) and the DOM can differ
    // by design. Suppressing the warning is the documented pattern for a
    // pre-paint theme script.
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#0b0e14" />
        <link rel="apple-touch-icon" href={`${basePath}/icon-192.png`} />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AppErrorBoundary>
          <I18nProvider>
            <WalletProvider>
              <WalletLayoutInner>{children}</WalletLayoutInner>
            </WalletProvider>
          </I18nProvider>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
