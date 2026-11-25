# End-to-end against a local Stellar network

`flow.spec.ts` drives the static export against the real Payflow contracts on a
standalone Stellar network — no mocked RPC. It publishes a plan, deposits into
the vault, subscribes, and cancels, signing every write with a generated
keypair through the Stellar Wallets Kit. It runs with `NEXT_PUBLIC_API_URL`
empty, so it proves the contract-only mode the public demo uses.

The CI job is `.github/workflows/e2e-local.yml`.

## Running locally

Docker is required for `stellar/quickstart`; everything else is already a
dependency of this repository.

```bash
npm ci
npx playwright install chromium

docker run --rm -d --name stellar-local -p 8000:8000 \
  stellar/quickstart:latest --local --limits unlimited

# Deploys the payflow-contract release wasm, wires the vault, funds two
# accounts, seeds one plan for the prerender, and writes .e2e/contracts.json.
node e2e/local/deploy-contracts.mjs

# Build the export against those ids with no indexer. --shell quotes the
# passphrase, which contains spaces and a semicolon.
eval "$(node e2e/local/export-env.mjs --shell)"
npm run build

npx playwright test --config playwright.e2e.config.ts
docker rm -f stellar-local
```

`.e2e/` is git-ignored: it holds the deployed contract ids and the ephemeral
keys the run generated.

## What the suite covers

| Step | Write | Proof |
|---|---|---|
| Publish a plan | `create_plan` | `Done. Transaction` notice, then `get_plan` matches the form |
| Deposit | vault `deposit` | `Done. Transaction` notice, then `balance(user, token)` is 5 XLM |
| Subscribe | `subscribe` | `Subscribed. Transaction` notice, then `get_mandate` is `["Active"]` |
| Cancel | `cancel` | `Cancelled` badge, then `get_mandate` is `["Cancelled"]` |

The `E2E test wallet` module is compiled in only when
`NEXT_PUBLIC_E2E_WALLET=1` (see `src/lib/wallet-modules.ts`); the test provides
its ephemeral key after the page loads and before opening the wallet modal.
The local E2E export sets `NEXT_PUBLIC_DISABLE_CSP=1` so its inline boot code
and Playwright wallet injection can run; this setting is not used by production
builds. The wallet module remains unavailable unless the test provides a key.
