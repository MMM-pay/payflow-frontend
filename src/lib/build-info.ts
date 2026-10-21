import { config, explorerBase } from "@/lib/config";
import { shortAddress } from "@/lib/format";

/**
 * Values injected at build time via next.config.mjs env config.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
export const COMMIT_HASH = process.env.NEXT_PUBLIC_COMMIT_HASH ?? "";

export const REPO_URL = "https://github.com/MMM-pay/payflow-frontend";

/**
 * Format an app version string with a leading "v" if not already present.
 * Blank or empty versions return an empty string.
 */
export function formatVersion(version?: string): string {
  if (!version) return "";
  const trimmed = version.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

/**
 * Format a git commit hash to its short 7-character prefix.
 */
export function formatCommit(hash?: string): string {
  if (!hash) return "";
  const trimmed = hash.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 7);
}

/**
 * Build a GitHub URL pointing to the specified commit.
 */
export function getCommitUrl(hash?: string, repoUrl: string = REPO_URL): string | null {
  const short = formatCommit(hash);
  if (!short) return null;
  return `${repoUrl}/commit/${short}`;
}

/**
 * Build the Stellar Expert explorer link for a contract ID.
 */
export function getContractUrl(contractId?: string, base: string = explorerBase): string | null {
  if (!contractId) return null;
  const trimmed = contractId.trim();
  if (!trimmed) return null;
  return `${base}/contract/${trimmed}`;
}

export interface ContractLinkItem {
  name: string;
  id: string;
  shortId: string;
  url: string | null;
}

/**
 * Generate the contract link metadata for the three protocol contracts
 * (Plan registry, Vault, and Subscription).
 */
export function getProtocolContractLinks(
  contracts: {
    planRegistry?: string;
    vault?: string;
    subscription?: string;
  } = config.contracts,
  base: string = explorerBase,
): ContractLinkItem[] {
  const definitions = [
    { name: "Plan registry", id: contracts.planRegistry ?? "" },
    { name: "Vault", id: contracts.vault ?? "" },
    { name: "Subscription", id: contracts.subscription ?? "" },
  ];

  return definitions.map(({ name, id }) => {
    const trimmedId = id.trim();
    return {
      name,
      id: trimmedId,
      shortId: trimmedId ? shortAddress(trimmedId, 4) : "",
      url: getContractUrl(trimmedId, base),
    };
  });
}

/**
 * Build a debug information string for bug reports.
 * Includes version, commit, network, contract IDs, API URL, and wallet info.
 * No secrets are included.
 */
export interface DebugInfo {
  version: string;
  commit: string;
  network: string;
  networkPassphrase: string;
  contracts: {
    planRegistry: string;
    vault: string;
    subscription: string;
    token: string;
  };
  apiUrl: string;
  wallet?: {
    name: string;
    address: string;
  };
}

/**
 * Collect debug information from the current app state.
 * Call this from a client component where wallet info is available.
 */
export function buildDebugInfo(
  wallet?: { name: string; address: string } | null,
): DebugInfo {
  return {
    version: APP_VERSION || "unknown",
    commit: COMMIT_HASH || "unknown",
    network: config.network || "TESTNET",
    networkPassphrase: config.networkPassphrase,
    contracts: {
      planRegistry: config.contracts.planRegistry || "not configured",
      vault: config.contracts.vault || "not configured",
      subscription: config.contracts.subscription || "not configured",
      token: config.contracts.token || "not configured",
    },
    apiUrl: config.apiUrl || "not configured",
    wallet: wallet ?? undefined,
  };
}

/**
 * Format debug info as a human-readable string for copying.
 */
export function formatDebugInfo(info: DebugInfo): string {
  const lines = [
    "=== Payflow Debug Info ===",
    `Version: ${info.version}`,
    `Commit: ${info.commit}`,
    `Network: ${info.network}`,
    `Network Passphrase: ${info.networkPassphrase}`,
    "",
    "Contracts:",
    `  Plan Registry: ${info.contracts.planRegistry}`,
    `  Vault: ${info.contracts.vault}`,
    `  Subscription: ${info.contracts.subscription}`,
    `  Token: ${info.contracts.token}`,
    "",
    `API URL: ${info.apiUrl}`,
    "",
  ];

  if (info.wallet) {
    lines.push("Wallet:");
    lines.push(`  Name: ${info.wallet.name}`);
    lines.push(`  Address: ${info.wallet.address}`);
    lines.push("");
  }

  lines.push("Generated at: " + new Date().toISOString());
  lines.push("==========================");

  return lines.join("\n");
}
