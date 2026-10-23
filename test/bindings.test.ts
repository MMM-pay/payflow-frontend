import { describe, expect, it } from "vitest";
import { scValToNative, type xdr } from "@stellar/stellar-sdk";
import {
  createClient,
  planRegistryMethods,
  subscriptionMethods,
  vaultMethods,
  type ContractRuntime,
  type ContractScope,
  type SignXdr,
} from "@/lib/bindings";

/**
 * The bindings replace the hand-written contract wrappers, so a wrong method
 * name, scope or ScVal type would have no unit test protecting it. These call
 * the generated-style client through a fake runtime and decode the arguments
 * back, exactly as the contract would.
 */

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";
const SUBSCRIBER = "GAEWDXVDI3WI35TWTZXNQ4NTRYIG6J34XPRSNKX655LBA377M5ZOCBY5";
// The testnet SAC address for XLM: public network data, not a credential.
const SAC_ADDRESS = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const SIGN: SignXdr = async (xdr) => xdr;

interface Call {
  contractId: string;
  method: string;
  source: string;
  args: xdr.ScVal[];
}

function harness() {
  const calls: Call[] = [];
  const runtime: ContractRuntime = {
    async read<T>(
      contractId: string,
      method: string,
      source: string,
      args: xdr.ScVal[],
    ): Promise<T> {
      calls.push({ contractId, method, source, args });
      return null as T;
    },
    async write(contractId, method, source, _sign, args) {
      calls.push({ contractId, method, source, args });
      return "hash";
    },
  };
  const client = createClient(
    { ...planRegistryMethods, ...vaultMethods, ...subscriptionMethods },
    runtime,
    (scope: ContractScope) => `contract:${scope}`,
  );
  return { calls, client };
}

function decoded(call: Call | undefined): unknown[] {
  if (!call) throw new Error("expected the binding to make a call");
  return call.args.map((value) => scValToNative(value));
}

describe("generated contract bindings", () => {
  it("exposes every method in the three contract tables", () => {
    const { client } = harness();
    for (const name of [
      ...Object.keys(planRegistryMethods),
      ...Object.keys(vaultMethods),
      ...Object.keys(subscriptionMethods),
    ]) {
      expect(typeof (client as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("reads get_plan from the plan registry with a u64 id", async () => {
    const { calls, client } = harness();
    await client.getPlan(MERCHANT, 42n);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      contractId: "contract:plan_registry",
      method: "get_plan",
      source: MERCHANT,
    });
    expect(decoded(calls[0])).toEqual([42n]);
  });

  it("writes deposit_for without passing the caller as an argument", async () => {
    const { calls, client } = harness();
    await client.depositFor(MERCHANT, SIGN, SUBSCRIBER, SAC_ADDRESS, 10_000_000n);

    expect(calls[0]).toMatchObject({
      contractId: "contract:vault",
      method: "deposit_for",
      source: MERCHANT,
    });
    expect(decoded(calls[0])).toEqual([SUBSCRIBER, SAC_ADDRESS, 10_000_000n]);
  });

  it("omits create_plan's trial argument when the caller has none", async () => {
    const { calls, client } = harness();
    await client.createPlan(MERCHANT, SIGN, {
      token: SAC_ADDRESS,
      amount: 10_000_000n,
      period: 2_592_000,
      name: "Pro Monthly",
    });

    expect(decoded(calls[0])).toEqual([
      MERCHANT,
      SAC_ADDRESS,
      10_000_000n,
      2_592_000n,
      "Pro Monthly",
    ]);
  });

  it("appends create_plan's trial argument when one is supplied", async () => {
    const { calls, client } = harness();
    await client.createPlan(MERCHANT, SIGN, {
      token: SAC_ADDRESS,
      amount: 10_000_000n,
      period: 2_592_000,
      name: "Pro Monthly",
      trial: 604_800,
    });

    expect(decoded(calls[0])).toEqual([
      MERCHANT,
      SAC_ADDRESS,
      10_000_000n,
      2_592_000n,
      "Pro Monthly",
      604_800n,
    ]);
  });

  it("encodes subscription writes with their contract-specific arguments", async () => {
    const { calls, client } = harness();
    await client.subscribe(SUBSCRIBER, SIGN, 7n, 12);
    await client.setPaused(SUBSCRIBER, SIGN, 7n, true);
    await client.refund(MERCHANT, SIGN, 7n, 5_000_000n);

    expect(decoded(calls[0])).toEqual([SUBSCRIBER, 7n, 12]);
    expect(calls[0]?.method).toBe("subscribe");
    // set_paused is a merchant-side call: the source is not an argument.
    expect(decoded(calls[1])).toEqual([7n, true]);
    expect(calls[1]?.method).toBe("set_paused");
    expect(decoded(calls[2])).toEqual([MERCHANT, 7n, 5_000_000n]);
    expect(calls[2]?.method).toBe("refund");
  });

  it("reads paged indexes with address and u32 bounds", async () => {
    const { calls, client } = harness();
    await client.merchantPlans(MERCHANT, MERCHANT, 0, 50);

    expect(calls[0]).toMatchObject({
      contractId: "contract:plan_registry",
      method: "merchant_plans",
    });
    expect(decoded(calls[0])).toEqual([MERCHANT, 0, 50]);
  });
});
