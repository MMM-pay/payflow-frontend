# PR body (corrected) — paste into https://github.com/MMM-pay/payflow-frontend/pull/228

Closes #20
Closes #35

Both issues in one PR because #20 reworks `src/lib/config.ts` and #35 leans on the amount helpers next to it; the changes do not otherwise overlap.

## #20 — switch between testnet and mainnet configurations

- **Per-network configs** (`src/lib/config.ts`): testnet stays the built-in default and every existing `NEXT_PUBLIC_*` env var keeps working, so default behaviour is unchanged. Mainnet is assembled from new `NEXT_PUBLIC_MAINNET_*` vars (documented in `.env.example`) and stays out of the switcher until its RPC URL **and** contract ids (plan registry, vault, subscription, token) are set — a half-configured network is hidden, not offered broken.
- **Persisted choice, applied on load**: the active network resolves from `payflow.network` in localStorage when the page loads (default testnet; a stored choice the build no longer serves falls back to testnet). Switching persists the choice and **reloads the page** — deliberate rather than a shortcut: the module-level RPC server, token-metadata caches and the prerendered static HTML are all single-network, and a fresh load rebuilds every list from the chosen network's contracts. Describing it here per the issue's "better approach" note.
- **Header badge/switcher** (`WalletLayoutInner.tsx`): a labelled badge when the build serves one network, an accessible `<select>` when it serves several. Footer disclaimer, contract explorer links, the home-page "Deployed contracts" panel and the wallet mismatch warning (`expectedNetwork`) all follow the selected network.
- **Hydration-safe**, mirroring the theme toggle: the chrome renders the build default on first render and adopts the stored choice after mount, so the static export never mismatches.
- **Contract-only mode**: switching touches no backend. Mainnet defaults to an empty `NEXT_PUBLIC_MAINNET_API_URL`, i.e. contract-only; the indexer URL is per network.

## #35 — validate withdrawals and add a Max button

- New pure `checkWithdraw` in `src/lib/format.ts`: the amount must parse **and** fit the vault balance, as bigint in the token's smallest unit (never floats). A balance that has not loaded yet is refused, not assumed.
- The Withdraw button is disabled for over-balance input and the field says why: "Amount is more than your vault balance of X."
- Max fills the full balance at the token's own precision; the round-trip parses back to the same bigint, so it is never blocked.
- The panel subtitle explains that a withdrawal can stop upcoming charges (the next charge fails if it finds the vault short).

## Evidence

- `test/network.test.ts` (14 tests): registry from env, availability/hiding rules for every missing contract id, stored-choice resolution and fallback, blocked storage, config delegation shape.
- `test/network-switcher.test.tsx` (6 tests): badge vs switcher, option list, selection persistence via `selectNetwork`, footer disclaimer, mismatch banner passphrase.
- `test/format.test.ts`: `checkWithdraw` — under/at/over balance, one stroop over, loading balance, token decimals.
- `test/account-page.test.tsx`: over-balance input disables Withdraw and shows the message; Max fills the balance and enables it; Withdraw stays disabled while the balance loads.
- `npm run lint`, `npm run typecheck`, `npm test` (747 passed, 61 files) and `npm run build` (static export) are all green.
- Manual pass with `npm run dev` and the desktop + 375px screenshots (with and without a wallet, contract-only and with `NEXT_PUBLIC_API_URL`): **add these before requesting review** — they are not in the automated checks above.

## Screenshots

<!-- TODO: attach desktop and ~375px screenshots of the header switcher (single-network badge and multi-network select) and the Fund-your-vault panel with the Max button and the over-balance error. -->
