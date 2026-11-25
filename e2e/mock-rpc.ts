import type { Page, Route } from "@playwright/test";
import {
  Address,
  Keypair,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

/**
 * Soroban RPC mocked at the network layer (payflow-frontend#55).
 *
 * The visual and mocked-chain tests run the static export against canned
 * contract state, so the pages render the same way in every run, on every
 * machine, with no live network. The mock speaks the JSON-RPC dialect the
 * stellar-sdk expects:
 *
 *   - `getLedgerEntries` answers the account lookup every simulation performs
 *     first, for both the read source and the connected test wallet;
 *   - `simulateTransaction` decodes the invoked contract method out of the
 *     transaction XDR and returns the fixture for it, exactly like a
 *     successful simulation would;
 *   - `sendTransaction` and `getTransaction` finish the signing path with a
 *     deterministic hash and XDR the SDK accepts, with success, contract-error
 *     and on-chain-failure outcomes;
 *   - any method without a fixture fails with `Error(Contract, #2)`, which
 *     is what an older contract that has not shipped the method does, so the
 *     page renders its documented fallback state.
 *
 * The app is built with NEXT_PUBLIC_SOROBAN_RPC_URL set to VISUAL_RPC_URL
 * (see `build:visual` and the CI visual job), a host that does not resolve.
 * That makes the build-time `generateStaticParams` RPC probe fail fast and
 * fall back to /plans/1/, and lets these tests intercept every RPC call.
 * All other external requests (Horizon, the indexer, stellar.toml) are
 * aborted so nothing can reach the network.
 */

/** Must match the URL the app under test was built with. */
export const VISUAL_RPC_URL = "https://rpc.visual.test";

/** Must match NEXT_PUBLIC_NETWORK_PASSPHRASE of the build under test. */
export const VISUAL_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

/** Must match NEXT_PUBLIC_READ_SOURCE of the build under test. */
export const READ_SOURCE =
  "GAKOHW5FUKSF3SXQQWLD647RQJPOR5RZOS4ITSMWC5NPC67DEXXYU43H";

/** Must match NEXT_PUBLIC_TOKEN_ID of the build under test. */
export const XLM_SAC =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

type SubscribeOutcome = "success" | "contract-error" | "failed";

export interface MockRpcOptions {
  subscribe?: SubscribeOutcome;
}

type MockRpcCall =
  | { kind: "simulate"; contractMethod: string; args: unknown[] }
  | { kind: "sendTransaction"; hash: string }
  | { kind: "getTransaction"; hash: string; status: string };

export interface MockRpc {
  calls: MockRpcCall[];
  lastHash: string | null;
}

const LATEST_LEDGER = "100000";
const LEDGER_CLOSE_TIME = "1700000000";

const u64 = (v: number | bigint) => nativeToScVal(BigInt(v), { type: "u64" });
const u32 = (v: number) => nativeToScVal(v, { type: "u32" });
const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const str = (v: string) => nativeToScVal(v, { type: "string" });
const addr = (v: string) => new Address(v).toScVal();

function mapVal(entries: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(entries).map(
      ([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val }),
    ),
  );
}

/** A `Plan` as the contract encodes it. The id follows the `get_plan` argument. */
function plan(id: bigint): xdr.ScVal {
  return mapVal({
    id: u64(id),
    merchant: addr(READ_SOURCE),
    name: str("Coffee subscription"),
    token: addr(XLM_SAC),
    // 1 XLM, bigint stroops — money never goes through a float.
    amount: i128(10_000_000n),
    period: u64(2_592_000n), // 30 days
    active: xdr.ScVal.scvBool(true),
    trial: u64(0n),
  });
}

/** A `Mandate` as the contract encodes it: `status` is an enum variant vector. */
function mandate(id: bigint): xdr.ScVal {
  return mapVal({
    id: u64(id),
    subscriber: addr(READ_SOURCE),
    plan_id: u64(1n),
    merchant: addr(READ_SOURCE),
    token: addr(XLM_SAC),
    amount: i128(10_000_000n),
    period: u64(2_592_000n),
    next_charge: u64(4_102_444_800n), // far future: nothing is due in a test
    last_charge: u64(0n),
    charges_made: u32(0),
    max_charges: u32(0),
    fee_bps: u32(1000),
    status: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Active")]),
  });
}

/** Contract method -> the ScVal its simulation returns. */
const FIXTURES: Record<string, (args: xdr.ScVal[]) => xdr.ScVal> = {
  // plan registry
  get_plan: ([id]) => plan(scValToNative(id ?? u64(1n)) as bigint),
  next_plan_id: () => u64(3n),
  merchant_plan_count: () => u32(0),
  merchant_plans: () => xdr.ScVal.scvVec([]),
  // subscription
  get_mandate: ([id]) => mandate(scValToNative(id ?? u64(1n)) as bigint),
  fee_bps: () => u32(1000),
  is_due: () => xdr.ScVal.scvBool(false),
  subscriber_mandate_count: () => u32(0),
  subscriber_mandates: () => xdr.ScVal.scvVec([]),
  merchant_mandate_count: () => u32(0),
  merchant_mandates: () => xdr.ScVal.scvVec([]),
  plan_subscriber_count: () => u32(0),
  subscribe: () => xdr.ScVal.scvVoid(),
  // vault
  balance: () => i128(0n),
  // Reflector oracle (src/lib/price.ts): the fiat approximation on plan
  // cards. 0.25 at the `decimals` fixture's 7 places.
  lastprice: () =>
    mapVal({
      price: i128(2_500_000n),
      timestamp: u64(1_700_000_000n),
    }),
  // SEP-41 token metadata
  symbol: () => str("XLM"),
  name: () => str("Stellar Lumens"),
  decimals: () => u32(7),
};

function accountEntry(accountId: xdr.PublicKey): string {
  const entry = new xdr.AccountEntry({
    accountId,
    balance: 10_000_000_000n,
    seqNum: 123_456n,
    numSubEntries: 0,
    inflationDest: null,
    flags: 0,
    homeDomain: "",
    thresholds: Uint8Array.from([1, 0, 0, 0]),
    signers: [],
    ext: xdr.AccountEntryExt.v0(),
  });
  return xdr.LedgerEntryData.account(entry).toXdr("base64");
}

const READ_SOURCE_ENTRY = accountEntry(
  Keypair.fromPublicKey(READ_SOURCE).xdrPublicKey(),
);

function accountEntryFor(key: string): string {
  try {
    const parsed = xdr.LedgerKey.fromXdr(key, "base64");
    if (parsed.type === "account") return accountEntry(parsed.account.accountId);
  } catch {
    return READ_SOURCE_ENTRY;
  }
  return READ_SOURCE_ENTRY;
}

const SUCCESS_RESULT_XDR = new xdr.TransactionResult({
  feeCharged: 100n,
  result: xdr.TransactionResultResult.txSuccess([]),
  ext: xdr.TransactionResultExt.v0(),
}).toXdr("base64");

const SUCCESS_META_XDR = xdr.TransactionMeta.v3(
  new xdr.TransactionMetaV3({
    ext: xdr.ExtensionPoint.v0(),
    txChangesBefore: [],
    operations: [],
    txChangesAfter: [],
    sorobanMeta: null,
  }),
).toXdr("base64");

const SIMULATION_BASE = {
  transactionData: new SorobanDataBuilder().build().toXdr("base64"),
  minResourceFee: "100",
  events: [],
  cost: { cpuInsns: "0", memBytes: "0" },
  latestLedger: LATEST_LEDGER,
  latestLedgerCloseTime: LEDGER_CLOSE_TIME,
  oldestLedger: "1",
  oldestLedgerCloseTime: "0",
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

/** The invoked contract method and its ScVal arguments, read from the XDR. */
function decodeCall(
  transactionXdr: string,
): { method: string; args: xdr.ScVal[] } | null {
  try {
    const envelope = TransactionBuilder.fromXDR(
      transactionXdr,
      VISUAL_NETWORK_PASSPHRASE,
    ).toEnvelope();
    if (envelope.type !== "envelopeTypeTx") return null;
    const body = envelope.v1.tx.operations[0]?.body;
    if (body?.type !== "invokeHostFunction") return null;
    const hostFunction = body.invokeHostFunctionOp.hostFunction;
    if (hostFunction.type !== "hostFunctionTypeInvokeContract") return null;
    return {
      method: hostFunction.invokeContract.functionName.toString(),
      args: hostFunction.invokeContract.args,
    };
  } catch {
    return null;
  }
}

interface MockRpcState extends MockRpc {
  envelopeXdr: string;
}

async function handleRpc(
  route: Route,
  options: MockRpcOptions,
  state: MockRpcState,
): Promise<void> {
  const request = route.request();
  if (request.method() !== "POST") {
    return route.fulfill({ status: 204, headers: CORS_HEADERS });
  }
  let body: {
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
  };
  try {
    body = JSON.parse(request.postData() ?? "{}");
  } catch {
    body = {};
  }
  const reply = (result: unknown) =>
    route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, result }),
    });

  switch (body.method) {
    case "getHealth":
      return reply({ status: "success", latestLedger: LATEST_LEDGER });
    case "getLedgerEntries": {
      const keys = (body.params?.keys as string[] | undefined) ?? [];
      return reply({
        entries: keys.map((key) => ({
          key,
          xdr: accountEntryFor(key),
          lastModifiedLedgerSeq: Number(LATEST_LEDGER),
        })),
        latestLedger: LATEST_LEDGER,
        latestLedgerCloseTime: LEDGER_CLOSE_TIME,
      });
    }
    case "simulateTransaction": {
      const call = decodeCall(String(body.params?.transaction ?? ""));
      if (call) {
        state.calls.push({
          kind: "simulate",
          contractMethod: call.method,
          args: call.args.map((value) => scValToNative(value)),
        });
      }
      const fixture = call ? FIXTURES[call.method] : undefined;
      if (!call || !fixture) {
        return reply({
          ...SIMULATION_BASE,
          error: "HostError: Error(Contract, #2)",
        });
      }
      if (call.method === "subscribe" && options.subscribe === "contract-error") {
        return reply({
          ...SIMULATION_BASE,
          error: "HostError: Error(Contract, #3)",
        });
      }
      return reply({
        ...SIMULATION_BASE,
        results: [{ auth: [], xdr: fixture(call.args).toXdr("base64") }],
      });
    }
    case "sendTransaction": {
      try {
        const envelope = String(body.params?.transaction ?? "");
        const hash = Buffer.from(
          TransactionBuilder.fromXDR(envelope, VISUAL_NETWORK_PASSPHRASE).hash(),
        ).toString("hex");
        state.envelopeXdr = envelope;
        state.lastHash = hash;
        state.calls.push({ kind: "sendTransaction", hash });
        return reply({ status: "PENDING", hash, latestLedger: LATEST_LEDGER });
      } catch (err) {
        return reply({
          error: {
            code: -32602,
            message: `mock-rpc: invalid transaction ${String(err)}`,
          },
        });
      }
    }
    case "getTransaction": {
      const hash = String(body.params?.hash ?? state.lastHash ?? "");
      const status = options.subscribe === "failed" ? "FAILED" : "SUCCESS";
      state.calls.push({ kind: "getTransaction", hash, status });
      return reply({
        status,
        txHash: hash,
        ledger: Number(LATEST_LEDGER),
        createdAt: LEDGER_CLOSE_TIME,
        applicationOrder: 1,
        feeBump: false,
        envelopeXdr: state.envelopeXdr,
        resultXdr: SUCCESS_RESULT_XDR,
        resultMetaXdr: SUCCESS_META_XDR,
        events: { contractEventsXdr: [], transactionEventsXdr: [] },
      });
    }
    default:
      return reply({
        error: {
          code: -32601,
          message: `mock-rpc: unhandled method ${String(body.method)}`,
        },
      });
  }
}

export async function installMockRpc(
  page: Page,
  options: MockRpcOptions = {},
): Promise<MockRpc> {
  const state: MockRpcState = { calls: [], lastHash: null, envelopeXdr: "" };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      return route.continue();
    }
    if (url.origin === new URL(VISUAL_RPC_URL).origin) {
      return handleRpc(route, options, state);
    }
    return route.abort();
  });
  return state;
}
