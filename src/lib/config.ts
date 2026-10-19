/**
 * Every value here is inlined at build time. Changing an env var on the host
 * requires a rebuild, not just a restart — this is the usual cause of a
 * deployed frontend still calling localhost.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and set it, then rebuild.`,
    );
  }
  return value;
}

const networkName = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "TESTNET";
const isTestnetNetwork = networkName.toUpperCase() === "TESTNET";

export const config = {
  rpcUrl:
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
  networkPassphrase:
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
  network: networkName,
  /**
   * Horizon serves the connected account's native balance and whether the
   * account exists on the network at all. Soroban RPC's `getAccount` returns
   * only the sequence number, so it cannot answer either question.
   */
  horizonUrl:
    process.env.NEXT_PUBLIC_HORIZON_URL ??
    (isTestnetNetwork ? "https://horizon-testnet.stellar.org" : "https://horizon.stellar.org"),
  /**
   * Friendbot is a testnet faucet with no mainnet equivalent, so the button
   * that calls it is driven off this rather than off a runtime network check.
   */
  friendbotUrl: isTestnetNetwork ? "https://friendbot.stellar.org" : null,
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080",
  /**
   * Source account used for read-only contract simulation before a wallet is
   * connected. Simulation never touches this account — it only has to exist on
   * the network. Defaults to the deployer of the public testnet suite.
   */
  readSource:
    process.env.NEXT_PUBLIC_READ_SOURCE ??
    "GAKOHW5FUKSF3SXQQWLD647RQJPOR5RZOS4ITSMWC5NPC67DEXXYU43H",
  contracts: {
    planRegistry: process.env.NEXT_PUBLIC_PLAN_REGISTRY_ID ?? "",
    vault: process.env.NEXT_PUBLIC_VAULT_ID ?? "",
    subscription: process.env.NEXT_PUBLIC_SUBSCRIPTION_ID ?? "",
    token: process.env.NEXT_PUBLIC_TOKEN_ID ?? "",
  },
} as const;

export function requireContracts(): void {
  required("NEXT_PUBLIC_PLAN_REGISTRY_ID", config.contracts.planRegistry);
  required("NEXT_PUBLIC_VAULT_ID", config.contracts.vault);
  required("NEXT_PUBLIC_SUBSCRIPTION_ID", config.contracts.subscription);
}

export const explorerBase = "https://stellar.expert/explorer/testnet";
