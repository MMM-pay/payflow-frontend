import { afterEach, describe, expect, it, vi } from "vitest";
import type { NetworkConfig } from "@/lib/config";

/**
 * The per-network config behind the header switcher (issue #20).
 *
 * These functions decide which networks a build offers and which one is in
 * force. Getting them wrong sends users at contracts that do not exist — a
 * half-configured mainnet appearing in the switcher, or a stored choice
 * surviving a build that no longer serves that network — so each rule is
 * pinned here without rendering React.
 *
 * `config.ts` reads NEXT_PUBLIC_* at module load, so every case imports it
 * fresh after stubbing the env.
 */

const MAINNET_ENV = {
  NEXT_PUBLIC_MAINNET_SOROBAN_RPC_URL: "https://soroban.example.org",
  NEXT_PUBLIC_MAINNET_PLAN_REGISTRY_ID: "mainnet-registry",
  NEXT_PUBLIC_MAINNET_VAULT_ID: "mainnet-vault",
  NEXT_PUBLIC_MAINNET_SUBSCRIPTION_ID: "mainnet-subscription",
  NEXT_PUBLIC_MAINNET_TOKEN_ID: "mainnet-token",
};

async function loadConfig() {
  vi.resetModules();
  return await import("@/lib/config");
}

function storageStub(values: Record<string, string | null> = {}) {
  return {
    getItem: vi.fn((key: string) => values[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values[key] = value;
    }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("network registry", () => {
  it("serves testnet only when no mainnet env is set — behaviour unchanged by default", async () => {
    const { NETWORKS, activeNetwork, explorerBase } = await loadConfig();

    expect(NETWORKS.map((n) => n.id)).toEqual(["testnet"]);
    expect(activeNetwork().id).toBe("testnet");
    expect(explorerBase).toBe("https://stellar.expert/explorer/testnet");
  });

  it("keeps the historical env overrides working for testnet", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_URL", "https://rpc.override.example");
    vi.stubEnv("NEXT_PUBLIC_PLAN_REGISTRY_ID", "registry-override");
    const { config } = await loadConfig();

    expect(config.rpcUrl).toBe("https://rpc.override.example");
    expect(config.contracts.planRegistry).toBe("registry-override");
    expect(config.networkPassphrase).toBe("Test SDF Network ; September 2015");
    expect(config.network).toBe("TESTNET");
  });

  it("adds mainnet only when its env is fully set, and hides it otherwise", async () => {
    // RPC URL alone is not enough: without contract ids the network would
    // render every list empty, so it must stay out of the switcher.
    vi.stubEnv("NEXT_PUBLIC_MAINNET_SOROBAN_RPC_URL", "https://soroban.example.org");
    let mod = await loadConfig();
    expect(mod.NETWORKS.map((n) => n.id)).toEqual(["testnet"]);
    expect(mod.availableNetworks().map((n) => n.id)).toEqual(["testnet"]);

    for (const [key, value] of Object.entries(MAINNET_ENV)) vi.stubEnv(key, value);
    mod = await loadConfig();
    expect(mod.NETWORKS.map((n) => n.id)).toEqual(["testnet", "mainnet"]);
    expect(mod.availableNetworks().map((n) => n.id)).toEqual(["testnet", "mainnet"]);
  });

  it("stays testnet-only while mainnet is missing any contract id", async () => {
    for (const key of Object.keys(MAINNET_ENV)) {
      for (const [full, value] of Object.entries(MAINNET_ENV)) {
        if (full !== key) vi.stubEnv(full, value);
      }
      const { availableNetworks } = await loadConfig();
      expect(availableNetworks().map((n) => n.id), `${key} empty`).toEqual(["testnet"]);
      vi.unstubAllEnvs();
    }
  });

  it("builds the mainnet network from its env", async () => {
    for (const [key, value] of Object.entries(MAINNET_ENV)) vi.stubEnv(key, value);
    const { NETWORKS } = await loadConfig();
    const mainnet = NETWORKS.find((n) => n.id === "mainnet") as NetworkConfig;

    expect(mainnet.rpcUrl).toBe("https://soroban.example.org");
    expect(mainnet.networkPassphrase).toBe("Public Global Stellar Network ; September 2015");
    expect(mainnet.network).toBe("PUBLIC");
    expect(mainnet.contracts).toMatchObject({
      planRegistry: "mainnet-registry",
      vault: "mainnet-vault",
      subscription: "mainnet-subscription",
      token: "mainnet-token",
    });
    expect(mainnet.explorerBase).toBe("https://stellar.expert/explorer/public");
    // The backend is per network; an empty URL runs this one contract-only.
    expect(mainnet.apiUrl).toBe("");
    expect(mainnet.tokens.map((t) => t.symbol)).toEqual(["XLM"]);
  });

  it("keeps testnet available even with no contract ids — it is the default", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLAN_REGISTRY_ID", "");
    vi.stubEnv("NEXT_PUBLIC_VAULT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_SUBSCRIPTION_ID", "");
    const { NETWORKS, availableNetworks } = await loadConfig();

    expect(NETWORKS.map((n) => n.id)).toEqual(["testnet"]);
    expect(availableNetworks().map((n) => n.id)).toEqual(["testnet"]);
  });
});

describe("resolveNetwork", () => {
  it("starts on testnet with nothing stored", async () => {
    const { resolveNetwork } = await loadConfig();
    expect(resolveNetwork(null).id).toBe("testnet");
  });

  it("adopts a stored choice that this build still serves", async () => {
    for (const [key, value] of Object.entries(MAINNET_ENV)) vi.stubEnv(key, value);
    const { resolveNetwork } = await loadConfig();
    expect(resolveNetwork("mainnet").id).toBe("mainnet");
  });

  it("falls back to testnet for a stored choice the build no longer serves", async () => {
    // The user picked mainnet, then loaded a build without mainnet env.
    const { resolveNetwork } = await loadConfig();
    expect(resolveNetwork("mainnet").id).toBe("testnet");
    expect(resolveNetwork("not-a-network").id).toBe("testnet");
  });

  it("falls back when mainnet is only half configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAINNET_SOROBAN_RPC_URL", "https://soroban.example.org");
    const { resolveNetwork } = await loadConfig();
    expect(resolveNetwork("mainnet").id).toBe("testnet");
  });
});

describe("stored network choice", () => {
  it("round-trips through storage", async () => {
    const { readStoredNetwork, saveStoredNetwork, NETWORK_STORAGE_KEY } = await loadConfig();
    const storage = storageStub();

    saveStoredNetwork(storage, "mainnet");
    expect(storage.setItem).toHaveBeenCalledWith(NETWORK_STORAGE_KEY, "mainnet");
    expect(readStoredNetwork(storage)).toBe("mainnet");
  });

  it("reads nothing from missing or blank storage", async () => {
    const { readStoredNetwork } = await loadConfig();
    expect(readStoredNetwork(null)).toBeNull();
    expect(readStoredNetwork(storageStub())).toBeNull();
    expect(readStoredNetwork(storageStub({ "payflow.network": "   " }))).toBeNull();
    expect(readStoredNetwork(storageStub({ "payflow.network": " mainnet " }))).toBe("mainnet");
  });

  it("treats blocked storage as nothing stored rather than throwing", async () => {
    const { readStoredNetwork, saveStoredNetwork } = await loadConfig();
    const blocked = {
      getItem: vi.fn(() => {
        throw new Error("denied");
      }),
      setItem: vi.fn(() => {
        throw new Error("denied");
      }),
    };

    expect(readStoredNetwork(blocked)).toBeNull();
    expect(() => saveStoredNetwork(blocked, "mainnet")).not.toThrow();
  });
});

describe("config delegation", () => {
  it("keeps the config object's shape while following the active network", async () => {
    // Every existing reader does `config.contracts…` etc. at call time; the
    // getters must answer with the active network's values and nothing else.
    const { config, activeNetwork } = await loadConfig();
    const network = activeNetwork();

    expect(config.rpcUrl).toBe(network.rpcUrl);
    expect(config.horizonUrl).toBe(network.horizonUrl);
    expect(config.networkPassphrase).toBe(network.networkPassphrase);
    expect(config.network).toBe(network.network);
    expect(config.apiUrl).toBe(network.apiUrl);
    expect(config.readSource).toBe(network.readSource);
    expect(config.contracts).toBe(network.contracts);
    expect(config.tokens).toBe(network.tokens);
  });
});
