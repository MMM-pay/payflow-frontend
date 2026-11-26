/**
 * Detects whether the browser has a Stellar wallet extension, so the app can
 * say so plainly instead of leaving a visitor with an empty wallet list.
 *
 * Only extension wallets are checked. Web wallets such as Albedo and xBull
 * report themselves as always available, so counting them would hide the
 * problem for a visitor who has nothing installed.
 */

/** Wallet ids (from the wallets kit) that live in the browser as an extension. */
export const EXTENSION_WALLET_IDS: readonly string[] = [
  "freighter",
  "lobstr",
  "rabet",
  "hana",
  "klever",
];

export interface InstallableWallet {
  name: string;
  url: string;
}

/** Where to get a wallet; the first entry is the one this app recommends. */
export const RECOMMENDED_WALLETS: readonly InstallableWallet[] = [
  { name: "Freighter", url: "https://www.freighter.app/" },
  { name: "LOBSTR", url: "https://lobstr.co/" },
];

/** The part of the kit's `getSupportedWallets()` entries this check reads. */
export interface DetectedWallet {
  id: string;
  isAvailable: boolean;
}

/**
 * True when none of the extension wallets is available. An empty or unusable
 * list answers `false`: not knowing is never a reason to show an install
 * prompt to someone who may already have a wallet.
 */
export function hasNoExtensionWallet(wallets: unknown): boolean {
  if (!Array.isArray(wallets)) return false;
  const extensions = wallets.filter(
    (wallet): wallet is DetectedWallet =>
      typeof wallet === "object" &&
      wallet !== null &&
      EXTENSION_WALLET_IDS.includes(String((wallet as { id?: unknown }).id).toLowerCase()),
  );
  if (extensions.length === 0) return false;
  return extensions.every((wallet) => wallet.isAvailable !== true);
}

/**
 * Asks the kit which wallets are available. Resolves `false` when the kit
 * cannot say (an older kit, a rejected call), so a failed probe never blocks
 * or alarms the visitor.
 */
export async function detectMissingWallet(kit: {
  getSupportedWallets?: () => Promise<unknown>;
}): Promise<boolean> {
  if (typeof kit.getSupportedWallets !== "function") return false;
  try {
    return hasNoExtensionWallet(await kit.getSupportedWallets());
  } catch {
    return false;
  }
}
