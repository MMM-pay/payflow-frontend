import type { Metadata, Viewport } from "next";
import "./globals.css";
import { I18nProvider } from "@/i18n/provider";
import { WalletProvider } from "@/lib/wallet";
import { WalletLayoutInner } from "@/components/WalletLayoutInner";
import { config } from "@/lib/config";
import { preconnectOrigins } from "@/lib/preconnect";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * The origins the first data request would otherwise open cold.
 *
 * Resolved once at build time: every route is prerendered, and both URLs are
 * inlined `NEXT_PUBLIC_*` values, so the hint list is static HTML rather than
 * runtime work. `crossOrigin` is required — RPC and indexer reads are CORS
 * fetches, and a hint without it warms a socket they cannot reuse.
 */
const PRECONNECT_ORIGINS = preconnectOrigins([
  config.rpcUrl,
  config.horizonUrl,
  config.apiUrl,
]);

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#0b0e14" />
        <link rel="apple-touch-icon" href={`${basePath}/icon-192.png`} />
        {PRECONNECT_ORIGINS.map((origin) => (
          <link key={origin} rel="preconnect" href={origin} crossOrigin="anonymous" />
        ))}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <I18nProvider>
        <WalletProvider>
          <WalletLayoutInner>{children}</WalletLayoutInner>
        </WalletProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
