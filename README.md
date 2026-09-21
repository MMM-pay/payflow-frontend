<h1 align="center">Payflow — Frontend</h1>

<p align="center">
  <strong>Merchant dashboard and subscriber portal for the Payflow protocol on Stellar.</strong>
</p>

<p align="center">
  <a href="https://github.com/MMM-pay/payflow-frontend/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/MMM-pay/payflow-frontend/actions/workflows/ci.yml/badge.svg"/>
  </a>
  <img alt="Next.js" src="https://img.shields.io/badge/next.js-15-black"/>
  <img alt="React" src="https://img.shields.io/badge/react-19-blue"/>
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-green"/>
</p>

> **Live demo:** https://mmm-pay.github.io/payflow-frontend/ ·
> **Docs:** https://mmm-pay.github.io/payflow-docs/

---

## What this is

The user-facing half of Payflow — pull-based recurring payments on Stellar.
Four pages:

| Route | Who it is for | What it does |
|---|---|---|
| `/` | everyone | Explains the mandate model, shows protocol counters and live contract IDs |
| `/subscribe` | subscribers | Browse published plans and open a mandate |
| `/account` | subscribers | Fund and withdraw from the vault, pause or cancel subscriptions |
| `/merchant` | merchants | Publish plans, track revenue, settle due mandates manually |

## Two data paths, on purpose

```
                  writes (signed by wallet)
  browser ──────────────────────────────────────► Soroban RPC ──► contracts
     │
     │            reads (lists, history, revenue)
     └──────────────────────────► payflow-backend ──► SQLite projection
```

Contract **writes** go straight from the browser to Soroban RPC. The backend is
never in the path of a payment and never holds a key.

Contract **reads** that need sorting or aggregation come from the indexer,
because Soroban cannot answer "list every mandate for this merchant." Every one
of those calls is allowed to fail: `src/lib/api.ts` returns `null` instead of
throwing, and the pages fall back to reading contract state directly. **The app
still works with the backend switched off** — you lose the lists, not the
ability to pay.

## Quick start

```bash
npm install
cp .env.example .env.local   # already points at the deployed testnet contracts
npm run dev
```

Open http://localhost:3000 and connect Freighter (or any wallet the
Stellar Wallets Kit supports) set to **Testnet**.

To see plans and history, run [payflow-backend](https://github.com/MMM-pay/payflow-backend)
alongside it on port 8080.

## Environment

Every variable is `NEXT_PUBLIC_*` and therefore **inlined at build time**.
Changing one on your host requires a redeploy, not a restart — this is the usual
reason a deployed frontend keeps calling `localhost`.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | RPC endpoint the browser signs against |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Network id passed to the wallet |
| `NEXT_PUBLIC_PLAN_REGISTRY_ID` | Deployed registry contract |
| `NEXT_PUBLIC_VAULT_ID` | Deployed vault contract |
| `NEXT_PUBLIC_SUBSCRIPTION_ID` | Deployed subscription contract |
| `NEXT_PUBLIC_TOKEN_ID` | SEP-41 token used for plans (native XLM SAC by default) |
| `NEXT_PUBLIC_API_URL` | payflow-backend base URL |

## Deploying to Vercel

1. Import the repo. Framework preset **Next.js**; defaults are correct.
2. Add every variable above under Settings → Environment Variables.
3. Set `NEXT_PUBLIC_API_URL` to your deployed backend URL — not `localhost`.
4. Set `CORS_ORIGIN` on the backend to this app's URL.
5. Redeploy after any variable change.

## Project layout

```
src/
  app/            routes: /, /subscribe, /account, /merchant
  components/     presentational pieces (ui.tsx, WalletButton.tsx)
  lib/
    payflow.ts    contract SDK — read via simulation, write via wallet
    api.ts        payflow-backend client (fails soft)
    wallet.tsx    Stellar Wallets Kit context
    format.ts     stroop/decimal conversion, period and address formatting
    config.ts     env access
```

`src/lib/payflow.ts` is the piece worth reading first: it maps every public
contract function to a typed call and translates raw `Error(Contract, #N)`
codes into sentences a user can act on.

## Related repositories

| Repo | Role |
|---|---|
| [payflow-contract](https://github.com/MMM-pay/payflow-contract) | Soroban contracts this app calls |
| [payflow-backend](https://github.com/MMM-pay/payflow-backend) | Indexer and API this app reads |
| [payflow-frontend](https://github.com/MMM-pay/payflow-frontend) | This repo |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). CI runs `typecheck` and `build`.

## Security

See [SECURITY.md](SECURITY.md). Unaudited, testnet only.

## Maintainers

| Name | Role | Contact |
|---|---|---|
| Victor Adeleke | Lead maintainer | [@titilope12](https://github.com/titilope12) |

## Contributors

<a href="https://github.com/MMM-pay/payflow-frontend/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=MMM-pay/payflow-frontend"/>
</a>

## License

Apache-2.0.
