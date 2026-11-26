/**
 * Print the build environment for the local-network end-to-end job
 * (payflow-frontend#117).
 *
 *   node e2e/local/export-env.mjs >> "$GITHUB_ENV"   # CI
 *   eval "$(node e2e/local/export-env.mjs --shell)"  # local
 *
 * `--shell` quotes values for the shell: the network passphrase contains
 * spaces and a semicolon (`Standalone Network ; February 2017`), which an
 * unquoted `KEY=value` cannot carry.
 *
 * NEXT_PUBLIC_API_URL is deliberately empty: the suite proves the
 * contract-only mode the public demo runs in.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const contracts = JSON.parse(
  await readFile(join(process.cwd(), ".e2e", "contracts.json"), "utf8"),
);

const env = {
  NEXT_PUBLIC_SOROBAN_RPC_URL: contracts.rpcUrl,
  NEXT_PUBLIC_HORIZON_URL: contracts.horizonUrl,
  NEXT_PUBLIC_NETWORK_PASSPHRASE: contracts.networkPassphrase,
  // The app's testnet profile; the passphrase above is what actually signs.
  NEXT_PUBLIC_STELLAR_NETWORK: "TESTNET",
  NEXT_PUBLIC_PLAN_REGISTRY_ID: contracts.contracts.planRegistry,
  NEXT_PUBLIC_VAULT_ID: contracts.contracts.vault,
  NEXT_PUBLIC_SUBSCRIPTION_ID: contracts.contracts.subscription,
  NEXT_PUBLIC_TOKEN_ID: contracts.contracts.token,
  NEXT_PUBLIC_READ_SOURCE: contracts.accounts.admin.publicKey,
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:4174",
  NEXT_PUBLIC_API_URL: "",
  // The test export needs its inline boot scripts to run without hashes: the
  // RSC flight payload embeds the policy and would have to hash itself.
  NEXT_PUBLIC_DISABLE_CSP: "1",
  // Compiles the keypair-backed wallet module the suite connects through.
  NEXT_PUBLIC_E2E_WALLET: "1",
  // The exported CSP hashes its own hash list inside Next's serialized flight
  // payload, so the hash of that payload no longer matches and hydration is
  // blocked. This job proves the contract/wallet flow, not the CSP, so use the
  // same opt-out as the visual build and keep the browser able to boot the app.
  NEXT_PUBLIC_DISABLE_CSP: "1",
};

const shell = process.argv.includes("--shell");
const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

for (const [key, value] of Object.entries(env)) {
  process.stdout.write(
    shell ? `export ${key}=${quote(value)}\n` : `${key}=${value}\n`,
  );
}
