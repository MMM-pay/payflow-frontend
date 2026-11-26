"use client";

import { useI18n } from "@/i18n/provider";
import { CopyButton } from "@/components/CopyButton";
import { explorerAddressUrl, truncateAddress, type StellarAddressKind } from "@/lib/address";
import { explorerBase } from "@/lib/config";

export interface AddressDisplayProps {
  value?: string | null;
  kind?: StellarAddressKind;
  prefixLength?: number;
  suffixLength?: number;
  /** Trusted app configuration may override the active network's explorer. */
  explorer?: string;
}

export function AddressDisplay({
  value,
  kind = "account",
  prefixLength = 6,
  suffixLength = 4,
  explorer = explorerBase,
}: AddressDisplayProps) {
  const { t: tr } = useI18n();
  const address = value?.trim() ?? "";

  if (!address) {
    return <span className="text-muted" aria-label={tr("Address unavailable")}>—</span>;
  }

  const href = explorerAddressUrl(address, kind, explorer);
  const display = truncateAddress(address, prefixLength, suffixLength);

  return (
    <span className="inline-flex max-w-full items-center gap-1 align-middle">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mono min-w-0 truncate text-muted underline-offset-2 hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          title={address}
          aria-label={address}
        >
          {display}
        </a>
      ) : (
        <span className="mono min-w-0 truncate text-muted" title={address} aria-label={address}>
          {display}
        </span>
      )}
      <CopyButton value={address} label={kind === "contract" ? tr("contract address") : tr("address")} />
    </span>
  );
}
