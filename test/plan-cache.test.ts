import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `get_plan` is cached for the session: a plan's name, price, period, token and
 * trial never change after `create_plan`, and only the `active` flag is trusted
 * for a short TTL. These tests count the calls that reach Soroban RPC, because
 * "fewer RPC calls on the second visit" is the point of the cache — asserting
 * on a helper would not catch a cache the pages never hit.
 *
 * The SDK's rpc.Server is replaced with a fake that answers simulation from a
 * mutable map of plans, so the real payflow wrappers (URL building, ScVal
 * encoding, decoding) are the code under test.
 */

const rpcCalls = vi.hoisted(() => ({
  getAccount: 0,
  simulate: 0,
  send: 0,
  nextPlanId: 0,
  plans: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();

  /** The contract method a simulated transaction invokes. */
  function methodOf(tx: unknown): string {
    const invoke = invokeOf(tx);
    return Buffer.from(invoke.functionName.bytes).toString("utf8");
  }

  /** The u64 first argument, which is the plan id on every read here. */
  function planIdOf(tx: unknown): bigint {
    const value = invokeOf(tx).args[0]?.u64;
    if (typeof value !== "bigint") throw new Error("expected a u64 plan id");
    return value;
  }

  /**
   * stellar-sdk keeps an operation's host function as a plain XDR object;
   * `toXdrObject()` exposes the invoke contract arguments as properties.
   */
  function invokeOf(tx: unknown) {
    const operations = (tx as { operations: unknown[] }).operations;
    const func = (operations[0] as { func: { toXdrObject: () => unknown } }).func;
    return (
      func.toXdrObject() as {
        invokeContract: {
          functionName: { bytes: Uint8Array };
          args: { u64?: bigint }[];
        };
      }
    ).invokeContract;
  }

  class FakeServer {
    async getAccount(publicKey: string) {
      rpcCalls.getAccount += 1;
      return new actual.Account(publicKey, "1");
    }

    async simulateTransaction(tx: unknown) {
      rpcCalls.simulate += 1;
      const method = methodOf(tx);
      if (method === "next_plan_id") {
        return {
          result: {
            retval: actual.nativeToScVal(BigInt(rpcCalls.nextPlanId), { type: "u64" }),
          },
        };
      }
      if (method === "get_plan") {
        const id = String(planIdOf(tx));
        const plan = rpcCalls.plans.get(id);
        if (!plan) throw new Error(`no plan ${id} in the fake contract`);
        return { result: { retval: actual.nativeToScVal(plan) } };
      }
      throw new Error(`the fake contract has no method ${method}`);
    }

    // Write path: hand the built transaction straight back for signing, then
    // report it as confirmed. No sequence or fee checks are needed to test
    // whether a successful write drops the cached plan.
    async prepareTransaction(tx: unknown) {
      return tx;
    }

    async sendTransaction() {
      rpcCalls.send += 1;
      return { status: "PENDING", hash: "a".repeat(64) };
    }

    async getTransaction() {
      return { status: actual.rpc.Api.GetTransactionStatus.SUCCESS };
    }
  }

  return { ...actual, rpc: { ...actual.rpc, Server: FakeServer } };
});

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";
// The testnet SAC address for XLM: public network data, not a credential.
const SAC_ADDRESS = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const SOURCE = "GAKOHW5FUKSF3SXQQWLD647RQJPOR5RZOS4ITSMWC5NPC67DEXXYU43H";

// The contract ids come from `.env.local` in the app, which CI does not have,
// so pin a valid registry id here rather than depend on the developer's env.
vi.mock("@/lib/config", () => ({
  config: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "TESTNET",
    apiUrl: "",
    readSource: SOURCE,
    contracts: {
      planRegistry: "CDQ5EJTVXXX2CBMHWP3BGGUDHSK6D4I25IF5XXH3QGL2TNTBMJUOFKDB",
      vault: "CBNQEWSYYQOKNX5KB62OFT6ID5TCVSWN4PS4AXAJK6IWUEXOLVN6DXII",
      subscription: "CD5YZUJU6WLFIHGAV4J2BV42GCVZE5ZGDUGSW5CBRIA47TQHSZZW3XMM",
      token: SAC_ADDRESS,
    },
  },
}));

function planRecord(over: Record<string, unknown> = {}) {
  return {
    id: 1n,
    merchant: MERCHANT,
    name: "Pro Monthly",
    token: SAC_ADDRESS,
    amount: 10_000_000n,
    period: 2_592_000n,
    active: true,
    ...over,
  };
}

/** Put `count` active plans into the fake contract, newest id last. */
function seedPlans(count: number) {
  rpcCalls.nextPlanId = count + 1;
  for (let id = 1; id <= count; id += 1) {
    rpcCalls.plans.set(String(id), planRecord({ id: BigInt(id), name: `Plan ${id}` }));
  }
}

beforeEach(async () => {
  rpcCalls.getAccount = 0;
  rpcCalls.simulate = 0;
  rpcCalls.send = 0;
  rpcCalls.nextPlanId = 0;
  rpcCalls.plans.clear();
  const { clearPlanCache } = await import("@/lib/payflow");
  clearPlanCache();
});

describe("get_plan caching", () => {
  it("reads a plan once and serves later calls from memory", async () => {
    seedPlans(1);
    const { payflow } = await import("@/lib/payflow");

    const first = await payflow.getPlan(SOURCE, 1);
    const second = await payflow.getPlan(SOURCE, 1);

    expect(second).toEqual(first);
    expect(first.amount).toBe(10_000_000n);
    // One get_plan simulation, not two.
    expect(rpcCalls.simulate).toBe(1);
    expect(rpcCalls.getAccount).toBe(1);
  });

  it("caches each plan separately", async () => {
    seedPlans(2);
    const { payflow } = await import("@/lib/payflow");

    await payflow.getPlan(SOURCE, 1);
    await payflow.getPlan(SOURCE, 2);
    await payflow.getPlan(SOURCE, 1);
    await payflow.getPlan(SOURCE, 2);

    expect(rpcCalls.simulate).toBe(2);
  });

  it("re-reads the active flag once the short TTL expires", async () => {
    seedPlans(1);
    const { PLAN_ACTIVE_TTL_MS, payflow } = await import("@/lib/payflow");
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);

    await payflow.getPlan(SOURCE, 1);
    expect(rpcCalls.simulate).toBe(1);

    // Still inside the window: the merchant may not have changed it yet.
    now.mockReturnValue(1_000 + PLAN_ACTIVE_TTL_MS - 1);
    await payflow.getPlan(SOURCE, 1);
    expect(rpcCalls.simulate).toBe(1);

    // At the window's end the flag is no longer trusted, so one re-read
    // replaces the whole record.
    now.mockReturnValue(1_000 + PLAN_ACTIVE_TTL_MS);
    const refreshed = await payflow.getPlan(SOURCE, 1);
    expect(rpcCalls.simulate).toBe(2);
    expect(refreshed.active).toBe(true);

    now.mockRestore();
  });

  it("does not invent a trial for a contract that has no trial field", async () => {
    // The deployed Plan predates payflow-contract#9 and decodes to a map with
    // no `trial` key. Rebuilding the record from the cache must keep that key
    // absent rather than turning it into 0, which would claim "no trial" when
    // the source simply cannot say.
    seedPlans(1);
    const { payflow } = await import("@/lib/payflow");

    const first = await payflow.getPlan(SOURCE, 1);
    const second = await payflow.getPlan(SOURCE, 1);

    expect("trial" in first).toBe(false);
    expect("trial" in second).toBe(false);
    expect(second.active).toBe(true);
  });

  it("does not expire the immutable fields into a second read", async () => {
    // The TTL re-read is a single get_plan: the price, name and token come
    // back with the flag, so caching them costs nothing extra.
    seedPlans(1);
    const { PLAN_ACTIVE_TTL_MS, payflow } = await import("@/lib/payflow");
    const now = vi.spyOn(Date, "now").mockReturnValue(0);

    await payflow.getPlan(SOURCE, 1);
    now.mockReturnValue(PLAN_ACTIVE_TTL_MS);
    await payflow.getPlan(SOURCE, 1);

    expect(rpcCalls.simulate).toBe(2);
    now.mockRestore();
  });
});

describe("cache after the merchant's own change", () => {
  it("never serves the old active flag once set_plan_active has confirmed", async () => {
    seedPlans(1);
    const { cachedPlan, payflow } = await import("@/lib/payflow");

    const before = await payflow.getPlan(SOURCE, 1);
    expect(before.active).toBe(true);

    // The write reaches the contract: the fake plan flips before the wrapper
    // returns, exactly as a confirmed transaction would.
    const sign = vi.fn(async (xdr: string) => xdr);
    rpcCalls.plans.set("1", planRecord({ active: false }));
    await payflow.setPlanActive(SOURCE, sign, 1, false);

    // The entry is gone, so nothing can serve the pre-write value.
    expect(cachedPlan(1)).toBeNull();

    const after = await payflow.getPlan(SOURCE, 1);
    expect(after.active).toBe(false);
    expect(rpcCalls.simulate).toBe(2); // one read before, one re-read after
  });

  it("leaves the cache alone when the write fails", async () => {
    seedPlans(1);
    const { SIGNATURE_CANCELLED_MESSAGE, payflow } = await import("@/lib/payflow");

    await payflow.getPlan(SOURCE, 1);
    // A rejected signature is a failed write: the contract did not change, so
    // the cached record is still correct and should keep serving.
    const sign = vi.fn(async () => {
      throw new Error("User rejected the request.");
    });

    // A declined prompt is reported with the friendly message from
    // signature-error.ts, not the wallet's own text.
    await expect(payflow.setPlanActive(SOURCE, sign, 1, false)).rejects.toThrow(
      SIGNATURE_CANCELLED_MESSAGE,
    );
    expect((await payflow.getPlan(SOURCE, 1)).active).toBe(true);
    expect(rpcCalls.simulate).toBe(1);
  });
});

describe("chain fallback RPC cost", () => {
  it("reads only next_plan_id on a second visit", async () => {
    // What the public demo does: no indexer, so /subscribe enumerates the
    // registry. Three plans is enough to show the difference; the real cap is
    // 24 plans, so the saving scales with the list.
    seedPlans(3);
    const { chainPlans } = await import("@/lib/chain");

    const first = await chainPlans(SOURCE);
    const firstSimulations = rpcCalls.simulate;
    const firstAccounts = rpcCalls.getAccount;
    expect(first.map((p) => p.id)).toEqual([3, 2, 1]);
    expect(firstSimulations).toBe(4); // next_plan_id + one get_plan per plan

    const second = await chainPlans(SOURCE);

    // The ids still have to be read — create_plan moves next_plan_id — but
    // every plan record is cached.
    expect(rpcCalls.simulate - firstSimulations).toBe(1);
    expect(rpcCalls.getAccount - firstAccounts).toBe(1);
    expect(second).toEqual(first);
  });

  it("costs 2 RPC calls on a second visit at the 4- and 24-plan sizes", async () => {
    // The numbers in the changelog: every read costs a getAccount and a
    // simulate, so a visit is 2 * (1 + plans) RPC calls and a repeat visit
    // inside the TTL is just next_plan_id (2 calls).
    const { clearPlanCache } = await import("@/lib/payflow");
    const { chainPlans } = await import("@/lib/chain");
    const calls = () => rpcCalls.getAccount + rpcCalls.simulate;

    for (const count of [4, 24]) {
      clearPlanCache();
      seedPlans(count);
      rpcCalls.getAccount = 0;
      rpcCalls.simulate = 0;

      await chainPlans(SOURCE);
      expect(calls()).toBe(2 * (1 + count));

      await chainPlans(SOURCE);
      expect(calls()).toBe(2 * (1 + count) + 2);
      expect(rpcCalls.simulate).toBe(count + 2);
    }
  });

  it("still reflects a plan the merchant deactivated, once the TTL passes", async () => {
    // Caching must not hide a merchant's change from the public list.
    seedPlans(1);
    const { chainPlans } = await import("@/lib/chain");
    const { PLAN_ACTIVE_TTL_MS } = await import("@/lib/payflow");
    const now = vi.spyOn(Date, "now").mockReturnValue(0);

    expect((await chainPlans(SOURCE))[0]?.active).toBe(1);

    rpcCalls.plans.set("1", planRecord({ active: false }));
    now.mockReturnValue(PLAN_ACTIVE_TTL_MS);

    expect((await chainPlans(SOURCE))[0]?.active).toBe(0);
    now.mockRestore();
  });
});
