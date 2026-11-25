import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

/**
 * Shared plumbing for the local-network end-to-end suite (payflow-frontend#117).
 *
 * `deploy-contracts.mjs` writes `.e2e/contracts.json` before the app is built;
 * the build and these tests read the same file, so they cannot disagree about
 * which contract ids and accounts the run is about.
 */

export interface LocalContracts {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  contracts: {
    planRegistry: string;
    vault: string;
    subscription: string;
    token: string;
  };
  accounts: {
    admin: { publicKey: string; secret: string };
    subscriber: { publicKey: string; secret: string };
  };
}

export function loadContracts(): LocalContracts {
  const path = join(process.cwd(), ".e2e", "contracts.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LocalContracts;
  } catch (err) {
    throw new Error(
      `Could not read ${path}. Run "node e2e/local/deploy-contracts.mjs" against a local Stellar network first.`,
      { cause: err },
    );
  }
}

/** A `window` property the app's test wallet module reads when the modal opens. */
export async function installTestWallet(page: Page, secret: string, networkPassphrase: string) {
  await page.evaluate(
    ({ secretKey, passphrase }) => {
      (window as unknown as Record<string, unknown>).__PAYFLOW_E2E_WALLET__ = {
        secret: secretKey,
        networkPassphrase: passphrase,
      };
    },
    { secretKey: secret, passphrase: networkPassphrase },
  );
}

/**
 * Connect through the real wallet modal: the app opens the kit, the kit lists
 * the modules, and the test picks the keypair-backed one.
 */
export async function connectTestWallet(page: Page, address: string) {
  await page.getByRole("banner").getByRole("button", { name: "Connect wallet" }).click();
  await page.getByText("E2E test wallet", { exact: true }).click();
  // The header's address button carries the full address in its title.
  await expect(page.getByTitle(new RegExp(`^${address}`))).toBeVisible({ timeout: 20_000 });
}

/** Approve the app's action-specific review before the wallet signs. */
export async function approveWalletSigning(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue to wallet" })
    .click();
}

/** A read-only contract simulation, the same shape the app uses. */
export async function readContract<T>(
  contracts: LocalContracts,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<T> {
  const server = new rpc.Server(contracts.rpcUrl, {
    allowHttp: contracts.rpcUrl.startsWith("http://"),
  });
  const source = contracts.accounts.admin.publicKey;
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: contracts.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error}`);
  if (!("result" in sim) || !sim.result) throw new Error(`${method}: no simulation result`);
  return scValToNative(sim.result.retval) as T;
}

const u64 = (value: number | bigint) => nativeToScVal(value, { type: "u64" });
const address = (value: string) => new Address(value).toScVal();
const i128 = (value: bigint) => nativeToScVal(value, { type: "i128" });

export interface LocalPlan {
  id: bigint;
  merchant: string;
  name: string;
  token: string;
  amount: bigint;
  period: bigint;
  active: boolean;
}

export interface LocalMandate {
  id: bigint;
  subscriber: string;
  merchant: string;
  amount: bigint;
  status: unknown;
}

export function getPlan(contracts: LocalContracts, id: number | bigint) {
  return readContract<LocalPlan>(
    contracts,
    contracts.contracts.planRegistry,
    "get_plan",
    [u64(id)],
  );
}

export function getMandate(contracts: LocalContracts, id: number | bigint) {
  return readContract<LocalMandate>(
    contracts,
    contracts.contracts.subscription,
    "get_mandate",
    [u64(id)],
  );
}

export function getNextPlanId(contracts: LocalContracts) {
  return readContract<bigint>(contracts, contracts.contracts.planRegistry, "next_plan_id");
}

/**
 * The newest mandate the subscriber opened, read from the contract. The suite
 * caches it between tests, but a single test run (or a rerun against a network
 * that already has mandates) still has to find the row it acts on.
 */
export async function newestSubscriberMandate(
  contracts: LocalContracts,
  subscriber: string,
): Promise<bigint> {
  const count = await readContract<number>(
    contracts,
    contracts.contracts.subscription,
    "subscriber_mandate_count",
    [address(subscriber)],
  );
  if (!count) throw new Error(`${subscriber} has no mandates`);
  const ids = await readContract<bigint[]>(
    contracts,
    contracts.contracts.subscription,
    "subscriber_mandates",
    [address(subscriber), nativeToScVal(count - 1, { type: "u32" }), nativeToScVal(1, { type: "u32" })],
  );
  const id = ids[0];
  if (id === undefined) throw new Error(`${subscriber} has no mandate at ${count - 1}`);
  return BigInt(id);
}

export function getVaultBalance(contracts: LocalContracts, user: string) {
  return readContract<bigint>(contracts, contracts.contracts.vault, "balance", [
    address(user),
    address(contracts.contracts.token),
  ]);
}

/** Wallets keep their balance in stroops; the UI formats from bigint. */
export const XLM = 10_000_000n;
export { i128, u64 };
