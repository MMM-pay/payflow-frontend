import { activeNetwork } from "@/lib/config";

export type StellarAddressKind = "account" | "contract";

export function truncateAddress(
  address: string,
  prefixLength = 6,
  suffixLength = 4,
): string {
  const prefix = Math.max(0, Math.floor(Number.isFinite(prefixLength) ? prefixLength : 6));
  const suffix = Math.max(0, Math.floor(Number.isFinite(suffixLength) ? suffixLength : 4));
  if (address.length <= prefix + suffix + 1) return address;
  return `${address.slice(0, prefix)}…${suffix ? address.slice(-suffix) : ""}`;
}

export function explorerAddressUrl(
  value: string,
  kind: StellarAddressKind = "account",
  explorerBase: string = activeNetwork().explorerBase,
): string | null {
  const address = value.trim();
  const valid =
    kind === "contract"
      ? /^C[A-Z2-7]{55}$/.test(address)
      : /^G[A-Z2-7]{55}$/.test(address);
  if (!address || !valid) return null;

  try {
    const base = new URL(explorerBase);
    if (
      base.protocol !== "https:" ||
      base.hostname !== "stellar.expert" ||
      base.port ||
      base.username ||
      base.password ||
      !["/explorer/testnet", "/explorer/public"].includes(base.pathname.replace(/\/$/, ""))
    ) {
      return null;
    }
    return `${base.origin}${base.pathname.replace(/\/$/, "")}/${kind}/${encodeURIComponent(address)}`;
  } catch {
    return null;
  }
}
