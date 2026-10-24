/**
 * Every value here is inlined at build time. Changing an env var on the host
 * requires a rebuild, not just a restart — this is the usual cause of a
 * deployed frontend still calling localhost.
 *
 * The app ships one build that can serve more than one network: testnet is
 * built in (with the pre-existing env vars as overrides), mainnet exists only
 * when the NEXT_PUBLIC_MAINNET_* vars below are set. The user's choice lives
 * in localStorage and is applied when the page loads; switching networks
 * reloads the page so the module-level RPC server, the token-metadata caches
 * and the prerendered static HTML are all rebuilt for the new network.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and set it, then rebuild.`,
    );
  }
  return value;
}

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";

/**
 * Parse a comma-separated list of REC URLs into a trimmed, deduped,
 * non-empty array. Falls back to the single URL and then to the public
 * testnet endpoint so the app always has at least one endpoint.
 */
export function parseRpcUrls(list: string | undefined, fallback?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (list ?? "").split(",")) {
    const url = raw.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  if (out.length === 0) {
    out.push(fallback ?? DEFAULT_RPC_URL);
  }
  return out;
}

const rpcUrls = parseRpcUrls(
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URLS,
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? DEFAULT_RPC_URL,
);

export interface ClassicAsset {
  code: string;
  issuer: string;
}

export interface ConfiguredToken {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  classicAsset?: ClassicAsset;
}

/** The protocol contract ids a network deployment is identified by. */
export interface NetworkContracts {
  planRegistry: string;
  vault: string;
  subscription: string;
  token: string;
  usdc: string;
}

/** Everything the app needs in order to serve one Stellar network. */
export interface NetworkConfig {
  /** Stable id, persisted as the user's switcher choice. */
  id: string;
  label: string;
  rpcUrl: string;
  /** Horizon serves account `home_domain`s (stellar.toml names); RPC does not. */
  horizonUrl: string;
  networkPassphrase: string;
  /** Wallet-kit style name: "TESTNET" or "PUBLIC". */
  network: string;
  apiUrl: string;
  /**
   * Source account used for read-only contract simulation before a wallet is
   * connected. Simulation never touches this account — it only has to exist on
   * the network.
   */
  readSource: string;
  contracts: NetworkContracts;
  tokens: readonly ConfiguredToken[];
  /** Stellar Expert base for this network, e.g. .../explorer/testnet. */
  explorerBase: string;
  /** One-line footer disclaimer describing what this deployment is. */
  disclaimer: string;
}

const DEFAULT_XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const DEFAULT_USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

export const XLM_TOKEN: ConfiguredToken = {
  id: process.env.NEXT_PUBLIC_TOKEN_ID || DEFAULT_XLM_SAC,
  symbol: "XLM",
  name: "Stellar Lumens",
  decimals: 7,
};

export const USDC_TESTNET_TOKEN: ConfiguredToken = {
  id: process.env.NEXT_PUBLIC_USDC_TOKEN_ID || DEFAULT_USDC_SAC,
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  classicAsset: {
    code: "USDC",
    issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
};

export const CONFIGURED_TOKENS: readonly ConfiguredToken[] = [
  XLM_TOKEN,
  USDC_TESTNET_TOKEN,
];

/**
 * The built-in network. The pre-existing env vars (NEXT_PUBLIC_SOROBAN_RPC_URL
 * and friends) override it, so a build without any mainnet configuration
 * behaves exactly as before this multi-network support existed.
 */
const TESTNET: NetworkConfig = {
  id: "testnet",
  label: "Testnet",
  rpcUrl:
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  networkPassphrase:
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
  network: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "TESTNET",
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080",
  readSource:
    process.env.NEXT_PUBLIC_READ_SOURCE ??
    "GAKOHW5FUKSF3SXQQWLD647RQJPOR5RZOS4ITSMWC5NPC67DEXXYU43H",
  contracts: {
    planRegistry: process.env.NEXT_PUBLIC_PLAN_REGISTRY_ID ?? "",
    vault: process.env.NEXT_PUBLIC_VAULT_ID ?? "",
    subscription: process.env.NEXT_PUBLIC_SUBSCRIPTION_ID ?? "",
    token: process.env.NEXT_PUBLIC_TOKEN_ID ?? "",
    usdc: process.env.NEXT_PUBLIC_USDC_TOKEN_ID ?? DEFAULT_USDC_SAC,
  },
  tokens: [
    {
      id: process.env.NEXT_PUBLIC_TOKEN_ID || DEFAULT_XLM_SAC,
      symbol: "XLM",
      name: "Stellar Lumens",
      decimals: 7,
    },
    {
      id: process.env.NEXT_PUBLIC_USDC_TOKEN_ID || DEFAULT_USDC_SAC,
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      classicAsset: {
        code: "USDC",
        issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      },
    },
  ],
  explorerBase: "https://stellar.expert/explorer/testnet",
  disclaimer: "Stellar testnet · unaudited · do not use with real funds",
};

/**
 * Mainnet, entirely opt-in: every value comes from a NEXT_PUBLIC_MAINNET_*
 * var, and the network stays out of the switcher until its RPC URL and the
 * three protocol contract ids are set — a half-configured mainnet must never
 * be offered, because picking it would send users at contracts that do not
 * exist.
 */
const MAINNET: NetworkConfig = {
  id: "mainnet",
  label: "Mainnet",
  rpcUrl: process.env.NEXT_PUBLIC_MAINNET_SOROBAN_RPC_URL ?? "",
  horizonUrl: process.env.NEXT_PUBLIC_MAINNET_HORIZON_URL ?? "https://horizon.stellar.org",
  networkPassphrase:
    process.env.NEXT_PUBLIC_MAINNET_NETWORK_PASSPHRASE ??
    "Public Global Stellar Network ; September 2015",
  network: "PUBLIC",
  apiUrl: process.env.NEXT_PUBLIC_MAINNET_API_URL ?? "",
  readSource: process.env.NEXT_PUBLIC_MAINNET_READ_SOURCE ?? "",
  contracts: {
    planRegistry: process.env.NEXT_PUBLIC_MAINNET_PLAN_REGISTRY_ID ?? "",
    vault: process.env.NEXT_PUBLIC_MAINNET_VAULT_ID ?? "",
    subscription: process.env.NEXT_PUBLIC_MAINNET_SUBSCRIPTION_ID ?? "",
    token: process.env.NEXT_PUBLIC_MAINNET_TOKEN_ID ?? "",
    usdc: process.env.NEXT_PUBLIC_MAINNET_USDC_TOKEN_ID ?? "",
  },
  tokens: [
    {
      id: process.env.NEXT_PUBLIC_MAINNET_TOKEN_ID ?? "",
      symbol: "XLM",
      name: "Stellar Lumens",
      decimals: 7,
    },
  ],
  explorerBase: "https://stellar.expert/explorer/public",
  disclaimer: "Stellar mainnet · unaudited",
};

/**
 * Whether a network has everything it needs to be offered to the user: the
 * RPC to talk to, the passphrase to sign with, and every contract id the
 * pages read — a token id included, or vault amounts would be read against
 * an empty contract.
 */
export function isNetworkReady(network: NetworkConfig): boolean {
  return Boolean(
    network.rpcUrl &&
      network.networkPassphrase &&
      network.contracts.planRegistry &&
      network.contracts.vault &&
      network.contracts.subscription &&
      network.contracts.token,
  );
}

/**
 * Every network this build knows about. Testnet is always included — it is
 * what the app defaults to and what the historical env vars configure —
 * regardless of whether its contract ids are set (they are supplied at
 * deploy time by requireContracts' callers, not at selection time).
 */
export const NETWORKS: readonly NetworkConfig[] = [TESTNET, MAINNET].filter(
  (network) => network.id === TESTNET.id || isNetworkReady(network),
);

export const DEFAULT_NETWORK_ID = "testnet";

/** The network a fresh build (or an unknown stored choice) starts on. */
export function defaultNetwork(list: readonly NetworkConfig[] = NETWORKS): NetworkConfig {
  return list.find((n) => n.id === DEFAULT_NETWORK_ID) ?? list[0] ?? TESTNET;
}

/**
 * Networks the header switcher may offer. A network without contract ids is
 * hidden rather than shown-and-broken.
 */
export function availableNetworks(
  list: readonly NetworkConfig[] = NETWORKS,
): NetworkConfig[] {
  return list.filter((n) => n.id === DEFAULT_NETWORK_ID || isNetworkReady(n));
}

export const NETWORK_STORAGE_KEY = "payflow.network";

/** Minimal localStorage surface, so persistence is testable without a browser. */
export interface NetworkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readStoredNetwork(storage: NetworkStorage | null | undefined): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(NETWORK_STORAGE_KEY);
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
  } catch {
    // Storage can be blocked (private mode, policy). Fall back to the default.
    return null;
  }
}

export function saveStoredNetwork(storage: NetworkStorage, id: string): void {
  try {
    storage.setItem(NETWORK_STORAGE_KEY, id);
  } catch {
    // A blocked storage only means the choice is not remembered.
  }
}

/** The stored choice, resolved against the networks this build offers. */
export function resolveNetwork(
  stored: string | null,
  list: readonly NetworkConfig[] = NETWORKS,
): NetworkConfig {
  const match = stored
    ? availableNetworks(list).find((network) => network.id === stored)
    : undefined;
  return match ?? defaultNetwork(list);
}

/**
 * The network in force. Resolved once when the module loads: on the server
 * (and during the static export's prerender) there is no localStorage, so
 * both start on the default; in the browser the stored choice applies before
 * the first render, keeping the module-level RPC server and caches — which
 * are built from these values — on the right network from the start.
 */
const currentNetwork: NetworkConfig = resolveNetwork(
  readStoredNetwork(typeof window === "undefined" ? null : window.localStorage),
);

export function activeNetwork(): NetworkConfig {
  return currentNetwork;
}

/**
 * The explorer base for the network in force. Fixed for the lifetime of the
 * page: switching networks reloads, which re-resolves this from the new
 * active network.
 */
export const explorerBase: string = currentNetwork.explorerBase;

/**
 * Persist the user's network choice and reload.
 *
 * The reload is deliberate, not a shortcut: the RPC server, token metadata
 * caches and prerendered HTML are all built for one network, and every page
 * reads its lists through them. A fresh load rebuilds all of it from the
 * chosen network's config, so lists come from the right contracts. Networks
 * without contract ids are ignored — the switcher hides them anyway.
 */
export function selectNetwork(id: string): void {
  if (typeof window === "undefined") return;
  const target = availableNetworks().find((network) => network.id === id);
  if (!target || target.id === currentNetwork.id) return;
  saveStoredNetwork(window.localStorage, target.id);
  window.location.reload();
}

export const config = {
  /**
   * WalletConnect Cloud project id for the optional WalletConnect pairing.
   * Network-agnostic — the kit is constructed once per page load — so it
   * lives on `config` directly rather than on a `NetworkConfig`.
   */
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
  /**
   * Primary REC endpoint. Kept for backward compatibility; prefer
   * `config.rpcUrls` for fallback-aware code.
   */
  get rpcUrl() {
    return currentNetwork.rpcUrl;
  },
  /**
   * Friendbot is a testnet faucet with no mainnet equivalent, so the button
   * that uses it is hidden wherever this is null.
   */
  get friendbotUrl() {
    return currentNetwork.network === "TESTNET" ? "https://friendbot.stellar.org" : null;
  },
  /**
   * Path the site is served under. GitHub Pages serves a project site from
   * /<repo>, which the Next build injects here, so a link built in the
   * browser carries it.
   */
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  /** Ordered list of RPC endpoints to try in turn. */
  rpcUrls: rpcUrls as readonly string[],
  get horizonUrl() {
    return currentNetwork.horizonUrl;
  },
  get networkPassphrase() {
    return currentNetwork.networkPassphrase;
  },
  get network() {
    return currentNetwork.network;
  },
  get apiUrl() {
    return currentNetwork.apiUrl;
  },
  get readSource() {
    return currentNetwork.readSource;
  },
  get contracts() {
    return currentNetwork.contracts;
  },
  get tokens() {
    return currentNetwork.tokens;
  },
} as const;

export function requireContracts(): void {
  required("NEXT_PUBLIC_PLAN_REGISTRY_ID", config.contracts.planRegistry);
  required("NEXT_PUBLIC_VAULT_ID", config.contracts.vault);
  required("NEXT_PUBLIC_SUBSCRIPTION_ID", config.contracts.subscription);
}