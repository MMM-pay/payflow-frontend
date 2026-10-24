# Contributing to the Payflow Frontend

# # Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

You need a Stellar wallet extension (Freighter is the easiest) switched to
**Testnet**, and a funded testnet account. Fund one at
https://friendbot.stellar.org.

## What CI enforces

| Job | Command |
|---|---|
| `typecheck` | `npm run typecheck` |
| `build` | `npm run build` |

Both must pass. The build job supplies the public env vars; if you add a new
required variable, add it to the workflow too or the build breaks.

## Code standards

- **Strict TypeScript.** `strict` and `noUncheckedIndexedAccess` are on. Index
  access returns `T | undefined`; handle it rather than casting.
- **Money is `bigint`, never `number`.** Values arrive as stroops. Convert for
  display with `fromStroops`, parse input with `toStroops`. A float in a payment
  path is a bug.
- **Server components by default.** Add `"use client"` only when you need state,
  effects, or the wallet.
- **The wallet kit is browser-only.** It registers custom elements on
  construction. Import it dynamically; never instantiate at module scope.
- **Contract errors must be translated.** Add new `contracterror` codes to the
  `ERRORS` map in `src/lib/payflow.ts`. Users should never see
  `Error(Contract, #7)`.
- **Backend calls fail soft.** Anything in `src/lib/api.ts` returns `null` on
  failure. Never make a page crash because the indexer is down.

## Adding a contract call

1. Add the typed wrapper to `payflow` in `src/lib/payflow.ts`, encoding
   arguments with the `arg` helpers so ScVal types stay explicit.
2. Add any new error codes to `ERRORS`.
3. Wire it into a page with the `run()` pattern already used in
   `/account` and `/merchant`: set busy, clear notices, refresh on success.

## Commits

Conventional commits, one logical change each:

```
feat(merchant): add manual charge button for due mandates
fix(account): show vault balance in XLM rather than stroops
chore(ci): pass public contract ids to the build job
```
