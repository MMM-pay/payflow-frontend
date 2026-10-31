import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as stellarSdk from "@stellar/stellar-sdk";
import type { rpc } from "@stellar/stellar-sdk";
import {
  checkTrustline,
  clearPlanCache,
  isNetworkError,
  payflow,
  server,
  withFallback,
} from "@/lib/payflow";

/**
 * The contract layer this branch wires together: the endpoint fallback, the
 * Horizon trustline check, and the session wrappers around the generated
 * bindings. The RPC client is stubbed the way `payflow-retry.test.ts` stubs it,
 * so a test decides what each simulation and submission returns without a
 * network.
 */
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...original,
    rpc: {
      ...original.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getAccount: vi.fn().mockResolvedValue({}),
        simulateTransaction: vi.fn(),
        sendTransaction: vi.fn(),
        getTransaction: vi.fn(),
        prepareTransaction: vi.fn(),
      })),
      Api: {
        ...original.rpc.Api,
        isSimulationError: vi.fn(),
        GetTransactionStatus: { SUCCESS: "SUCCESS", NOT_FOUND: "NOT_FOUND" },
      },
    },
    Contract: vi.fn().mockImplementation(() => ({ call: vi.fn() })),
    TransactionBuilder: Object.assign(
      vi.fn().mockImplementation(() => ({
        addOperation: vi.fn().mockReturnThis(),
        setTimeout: vi.fn().mockReturnThis(),
        build: vi.fn().mockReturnValue({}),
      })),
      { fromXDR: vi.fn().mockReturnValue({}) },
    ),
    Address: vi.fn().mockImplementation(() => ({ toScVal: vi.fn().mockReturnValue({}) })),
    nativeToScVal: vi.fn().mockReturnValue({}),
    scValToNative: vi.fn().mockImplementation((value) => value?.retval ?? value),
    BASE_FEE: "100",
  };
});

const SOURCE = "GAKOHW5FUKSF3SXQQWLD647RQJPOR5RZOS4ITSMWC5NPC67DEXXYU43H";
const SIGN = async (xdr: string) => xdr;

const mockServer = server as unknown as {
  getAccount: ReturnType<typeof vi.fn>;
  simulateTransaction: ReturnType<typeof vi.fn>;
  sendTransaction: ReturnType<typeof vi.fn>;
  getTransaction: ReturnType<typeof vi.fn>;
  prepareTransaction: ReturnType<typeof vi.fn>;
};

/** A simulation result carrying a decoded `#[contracterror]` code. */
function simulationError(code: number) {
  // @ts-expect-error - mocking internal API
  stellarSdk.rpc.Api.isSimulationError.mockReturnValue(true);
  return { error: `Error(Contract, #${code})` };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPlanCache();
  mockServer.getAccount.mockResolvedValue({});
  mockServer.simulateTransaction.mockResolvedValue({ result: { retval: null } });
  mockServer.prepareTransaction.mockResolvedValue({ toXDR: () => "xdr" });
  mockServer.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "hash" });
  mockServer.getTransaction.mockResolvedValue({ status: "SUCCESS" });
  // @ts-expect-error - mocking internal API
  stellarSdk.rpc.Api.isSimulationError.mockReturnValue(false);
});

describe("isNetworkError", () => {
  it("treats a transport failure as retryable on another endpoint", () => {
    expect(isNetworkError(new TypeError("fetch failed"))).toBe(true);
    expect(isNetworkError(new Error("socket hang up"))).toBe(true);
  });

  it("does not treat a client error or a contract error as a network failure", () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError({ response: { status: 404 } })).toBe(false);
    expect(isNetworkError(new Error("Error(Contract, #3)"))).toBe(false);
  });

  it("treats a server error as a network failure", () => {
    expect(isNetworkError({ response: { status: 503 } })).toBe(true);
  });
});

describe("withFallback", () => {
  const endpoint = (name: string) => ({ name }) as unknown as rpc.Server;

  it("uses the next endpoint when a read fails with a network error", async () => {
    const seen: string[] = [];
    const result = await withFallback(
      async (srv) => {
        const id = (srv as unknown as { name: string }).name;
        seen.push(id);
        if (id === "primary") throw new TypeError("fetch failed");
        return id;
      },
      [endpoint("primary"), endpoint("secondary")],
    );

    expect(result).toBe("secondary");
    expect(seen).toEqual(["primary", "secondary"]);
  });

  it("rethrows a contract error without trying the next endpoint", async () => {
    const fn = vi.fn(async () => {
      throw new Error("Error(Contract, #3)");
    });

    await expect(withFallback(fn, [endpoint("primary"), endpoint("secondary")])).rejects.toThrow(
      "#3",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws the last error when every endpoint fails", async () => {
    await expect(
      withFallback(
        async () => {
          throw new TypeError("fetch failed");
        },
        [endpoint("primary"), endpoint("secondary")],
      ),
    ).rejects.toThrow("fetch failed");
  });
});

describe("checkTrustline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function horizon(body: unknown, ok = true) {
    return vi.fn().mockResolvedValue({ ok, json: async () => body });
  }

  it("treats a missing address, asset or endpoint as nothing to check", async () => {
    expect(await checkTrustline("", "USDC", "ISSUER")).toBe(true);
    expect(await checkTrustline(SOURCE, "", "ISSUER")).toBe(true);
    expect(await checkTrustline(SOURCE, "USDC", undefined, "")).toBe(true);
  });

  it("returns false when Horizon rejects the request", async () => {
    vi.stubGlobal("fetch", horizon({}, false));
    expect(await checkTrustline(SOURCE, "USDC")).toBe(false);
  });

  it("returns false when the account carries no balances", async () => {
    vi.stubGlobal("fetch", horizon({}));
    expect(await checkTrustline(SOURCE, "USDC")).toBe(false);
  });

  it("matches a balance by code, and by issuer when one is given", async () => {
    vi.stubGlobal(
      "fetch",
      horizon({
        balances: [{ asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "ISSUER" }],
      }),
    );

    expect(await checkTrustline(SOURCE, "USDC")).toBe(true);
    expect(await checkTrustline(SOURCE, "USDC", "ISSUER")).toBe(true);
    expect(await checkTrustline(SOURCE, "USDC", "OTHER")).toBe(false);
    expect(await checkTrustline(SOURCE, "EURC")).toBe(false);
  });

  it("returns false when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await checkTrustline(SOURCE, "USDC")).toBe(false);
  });
});

describe("session wrappers around the bindings", () => {
  const record = (name: string) => ({
    id: 1n,
    merchant: SOURCE,
    name,
    token: SOURCE,
    amount: 10_000_000n,
    period: 2_592_000n,
    active: true,
  });

  it("probes a rename by simulating it, and reports a registry without the method", async () => {
    mockServer.simulateTransaction.mockResolvedValue({ result: { retval: null } });
    expect(await payflow.supportsPlanRename(SOURCE, { id: 1, name: "Pro" })).toBe(true);

    mockServer.simulateTransaction.mockResolvedValue(simulationError(3));
    expect(await payflow.supportsPlanRename(SOURCE, { id: 1, name: "Pro" })).toBe(false);
  });

  it("renames a plan and drops the cached record", async () => {
    mockServer.simulateTransaction.mockResolvedValue({ result: { retval: record("Pro") } });
    expect((await payflow.getPlan(SOURCE, 1n)).name).toBe("Pro");

    mockServer.simulateTransaction.mockResolvedValue({
      result: { retval: record("Pro Monthly") },
    });
    await expect(payflow.setPlanName(SOURCE, SIGN, 1n, "Pro Monthly")).resolves.toBe("hash");

    // The cache entry went with the rename, so this read comes from the chain.
    mockServer.simulateTransaction.mockResolvedValue({ result: { retval: record("Renamed") } });
    expect((await payflow.getPlan(SOURCE, 1n)).name).toBe("Renamed");
  });

  it("rejects an empty plan name before the wallet opens", async () => {
    await expect(payflow.setPlanName(SOURCE, SIGN, 1n, "   ")).rejects.toThrow(
      /Enter a plan name/i,
    );
    expect(mockServer.sendTransaction).not.toHaveBeenCalled();
  });

  it("reads a profile, an empty profile and an unsupported registry", async () => {
    mockServer.simulateTransaction.mockResolvedValue({
      result: { retval: { name: "Acme", url: "https://acme.test" } },
    });
    expect(await payflow.getProfile(SOURCE)).toEqual({
      name: "Acme",
      url: "https://acme.test",
    });

    mockServer.simulateTransaction.mockResolvedValue({ result: { retval: {} } });
    expect(await payflow.getProfile(SOURCE)).toEqual({ name: "", url: "" });

    mockServer.simulateTransaction.mockResolvedValue(simulationError(3));
    expect(await payflow.getProfile(SOURCE)).toBeNull();
  });

  it("validates a profile before submitting it", async () => {
    await expect(
      payflow.setProfile(SOURCE, SIGN, { name: "x".repeat(65), url: "https://acme.test" }),
    ).rejects.toThrow(/too long/i);
    await expect(
      payflow.setProfile(SOURCE, SIGN, { name: "Acme", url: "not-a-url" }),
    ).rejects.toThrow(/http/i);
    expect(mockServer.sendTransaction).not.toHaveBeenCalled();

    await expect(
      payflow.setProfile(SOURCE, SIGN, { name: "Acme", url: "https://acme.test" }),
    ).resolves.toBe("hash");
  });
});
