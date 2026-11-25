/**
 * Deploy the Payflow contracts to a local Stellar network (payflow-frontend#117).
 *
 * The suite runs against the real contracts, not mocks: this script uploads
 * the wasm attached to the payflow-contract release, constructs the three
 * contracts the same way `payflow-contract/scripts/deploy.sh` does, wires the
 * vault's debit rights, funds the two test accounts from the local Friendbot,
 * and writes everything the app build and the Playwright suite need to
 * `.e2e/contracts.json` (git-ignored; the keys are ephemeral).
 *
 * Node and the repository's own @stellar/stellar-sdk do the work, so the job
 * needs no `stellar` CLI and no Rust toolchain.
 *
 *   node e2e/local/deploy-contracts.mjs
 *
 * Environment:
 *   E2E_RPC_URL            default http://127.0.0.1:8000/soroban/rpc
 *   E2E_FRIENDBOT_URL      default http://127.0.0.1:8000/friendbot
 *   E2E_NETWORK_PASSPHRASE default "Standalone Network ; February 2017"
 *   E2E_CONTRACT_RELEASE   default v0.2.0 (payflow-contract release tag)
 *   E2E_FEE_BPS            default 100
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  TransactionBuilder,
  hash,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

const RPC_URL = process.env.E2E_RPC_URL ?? "http://127.0.0.1:8000/soroban/rpc";
const FRIENDBOT_URL = process.env.E2E_FRIENDBOT_URL ?? "http://127.0.0.1:8000/friendbot";
const HORIZON_URL = process.env.E2E_HORIZON_URL ?? "http://127.0.0.1:8000";
const PASSPHRASE =
  process.env.E2E_NETWORK_PASSPHRASE ?? "Standalone Network ; February 2017";
const RELEASE = process.env.E2E_CONTRACT_RELEASE ?? "v0.2.0";
const FEE_BPS = Number(process.env.E2E_FEE_BPS ?? "100");
const REPO = "MMM-pay/payflow-contract";
const OUT_DIR = join(process.cwd(), ".e2e");
const WASM_DIR = join(OUT_DIR, "wasm");

const WASM = {
  planRegistry: "payflow_plan_registry.wasm",
  vault: "payflow_vault.wasm",
  subscription: "payflow_subscription.wasm",
};

const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const addr = (value) => new Address(value).toScVal();
const u32 = (value) => nativeToScVal(value, { type: "u32" });

function log(message) {
  process.stdout.write(`[contracts] ${message}\n`);
}

async function waitForNetwork() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const health = await server.getHealth();
      if (health.status === "healthy") return;
    } catch {
      // The container is still starting.
    }
    await sleep(1_000);
  }
  throw new Error(`local RPC did not become healthy at ${RPC_URL}`);
}

/**
 * Create and fund an account from the network's root account, for an
 * environment that runs without Friendbot (a quickstart started with
 * `--enable core,rpc` has no Horizon, and Friendbot needs one).
 */
async function fundFromRoot(publicKey) {
  const root = Keypair.fromSecret(process.env.E2E_ROOT_SECRET);
  const account = await server.getAccount(root.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.createAccount({ destination: publicKey, startingBalance: "10000" }))
    .setTimeout(120)
    .build();
  tx.sign(root);

  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    const result = JSON.stringify(sent.errorResult);
    // Running the script twice must not fail on accounts it already funded.
    if (result.includes("op_already_exists")) return;
    throw new Error(`root could not fund ${publicKey}: ${result}`);
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return;
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`funding ${publicKey} failed on-chain`);
    }
    await sleep(1_000);
  }
  throw new Error(`funding ${publicKey} was not confirmed`);
}

async function fund(publicKey) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
      if (res.ok) return;
      log(`friendbot answered ${res.status}, retrying`);
    } catch {
      log("friendbot is not up yet, retrying");
    }
    await sleep(1_000);
  }
  if (process.env.E2E_ROOT_SECRET) {
    log(`friendbot unavailable, funding ${publicKey} from the root account`);
    return fundFromRoot(publicKey);
  }
  throw new Error(`friendbot could not fund ${publicKey}`);
}

/** Submit one operation and poll until the network says it succeeded. */
async function submit(keypair, operation) {
  const account = await server.getAccount(keypair.publicKey());
  const built = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(120)
    .build();
  // prepareTransaction attaches the Soroban footprint and resource fee.
  const prepared = await server.prepareTransaction(built);
  prepared.sign(keypair);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`transaction rejected: ${JSON.stringify(sent.errorResult)}`);
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return result;
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`transaction ${sent.hash} failed on-chain`);
    }
    await sleep(1_000);
  }
  throw new Error(`transaction ${sent.hash} was not confirmed`);
}

async function ensureWasm() {
  await mkdir(WASM_DIR, { recursive: true });
  for (const name of Object.values(WASM)) {
    const file = join(WASM_DIR, name);
    try {
      await readFile(file);
      continue;
    } catch {
      // Not downloaded yet.
    }
    const url = `https://github.com/${REPO}/releases/download/${RELEASE}/${name}`;
    log(`downloading ${url}`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`could not download ${name}: ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
}

/** Upload the wasm, then construct the contract with its constructor args. */
async function deploy(keypair, wasm, constructorArgs) {
  const bytes = new Uint8Array(await readFile(join(WASM_DIR, wasm)));
  await submit(keypair, Operation.uploadContractWasm({ wasm: bytes }));
  const created = await submit(
    keypair,
    Operation.createCustomContract({
      address: new Address(keypair.publicKey()),
      // `hash` is SHA-256 over the wasm, the same digest the upload records.
      wasmHash: new Uint8Array(hash(bytes)),
      constructorArgs,
    }),
  );
  const value = created.returnValue;
  if (!(value instanceof xdr.ScVal)) {
    throw new Error(`${wasm} was deployed but the transaction returned no address`);
  }
  return Address.fromScVal(value).toString();
}

async function main() {
  log(`waiting for ${RPC_URL}`);
  await waitForNetwork();
  await ensureWasm();

  const admin = Keypair.random();
  const subscriber = Keypair.random();
  log(`admin      ${admin.publicKey()}`);
  log(`subscriber ${subscriber.publicKey()}`);
  await fund(admin.publicKey());
  await fund(subscriber.publicKey());

  // The native XLM Stellar Asset Contract has to exist before anything can
  // move XLM: the vault deposits through it. Quickstart deploys it during its
  // own setup, but a network started with `--enable core,rpc` has no setup
  // step, so deploy it here. Constructing it twice is harmless.
  log("deploying the native XLM Stellar Asset Contract");
  try {
    await submit(admin, Operation.createStellarAssetContract({ asset: Asset.native() }));
  } catch (err) {
    if (!/ExistingValue|already/i.test(String(err))) throw err;
    log("native SAC already deployed");
  }

  // Dependency order matters, exactly as payflow-contract/scripts/deploy.sh
  // documents: the subscription contract is constructed with the registry and
  // vault ids, and the vault must then be told who may debit it.
  log("deploying plan registry");
  const planRegistry = await deploy(admin, WASM.planRegistry, [addr(admin.publicKey())]);

  log("deploying vault");
  const vault = await deploy(admin, WASM.vault, [addr(admin.publicKey())]);

  log("deploying subscription");
  const subscription = await deploy(admin, WASM.subscription, [
    addr(admin.publicKey()),
    addr(planRegistry),
    addr(vault),
    u32(FEE_BPS),
    addr(admin.publicKey()),
  ]);

  log("granting the subscription contract debit rights on the vault");
  await submit(admin, new Contract(vault).call("set_subscription", addr(subscription)));

  // The native XLM Stellar Asset Contract id is derived from the network
  // passphrase, so the local network gets its own id instead of reusing the
  // testnet constant.
  const token = Asset.native().contractId(PASSPHRASE);

  // Seed one plan before the app is built. The dynamic /plans/[id]/ route is
  // prerendered from `next_plan_id`, and the export fails when a dynamic
  // segment has no params, so the registry must hold at least one plan at
  // build time. The suite publishes its own plan on top of this one.
  log("seeding one plan for the prerender");
  await submit(
    admin,
    new Contract(planRegistry).call(
      "create_plan",
      addr(admin.publicKey()),
      addr(token),
      nativeToScVal(10_000_000n, { type: "i128" }),
      nativeToScVal(2_592_000n, { type: "u64" }),
      nativeToScVal("Seed plan", { type: "string" }),
    ),
  );

  await writeFile(
    join(OUT_DIR, "contracts.json"),
    `${JSON.stringify(
      {
        rpcUrl: RPC_URL,
        horizonUrl: HORIZON_URL,
        networkPassphrase: PASSPHRASE,
        contracts: { planRegistry, vault, subscription, token },
        accounts: {
          admin: { publicKey: admin.publicKey(), secret: admin.secret() },
          subscriber: { publicKey: subscriber.publicKey(), secret: subscriber.secret() },
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  log(`wrote ${join(OUT_DIR, "contracts.json")}`);
  log(`plan registry ${planRegistry}`);
  log(`vault         ${vault}`);
  log(`subscription  ${subscription}`);
  log(`token         ${token}`);
}

main().catch((err) => {
  process.stderr.write(`[contracts] ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
