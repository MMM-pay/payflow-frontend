# Adding a page and wiring its data

A page in this app is three things: a route under `src/app/`, an entry in
`src/lib/pages.json`, and a loader that reads the indexer with a contract-only
fallback. The route directory alone gives you a page; the other two are what
make it findable, shareable and correct with the backend switched off.

The whole app is a **static export** (`output: "export"` in `next.config.mjs`,
`trailingSlash: true`). Every route is one prebuilt HTML file served from a CDN
or GitHub Pages, and every number on it is read in the browser after hydration.
There is no request-time server: nothing in `src/app/` may read a header, a
cookie or `searchParams` on the server, and a page that only works with a live
process behind it does not belong here.

## 1. Add the route

```
src/app/<slug>/
  page.tsx     the page itself
  layout.tsx   its metadata (see step 2)
```

Add `"use client"` when the page uses state, effects, the wallet or the
indexer. That is most pages; a page that renders only static markup can stay a
server component, and `src/app/page.tsx` is the model. Keep the client boundary
at the page, not in `src/lib/` — anything importing the wallet kit is
browser-only and must be loaded with `import()` where it is first used.

Three constraints come from the export, not from preference:

- **Paths end with `/`.** `trailingSlash` is on, so `/status/` is the URL that
  exists and `/status` is a redirect GitHub Pages may not do. `Link href="/status"`
  is fine — Next normalises it — but a hand-written `href` in a shared link or a
  canonical URL is not.
- **A dynamic segment has to be known at build time.** `/plans/[id]` works
  because `generateStaticParams` pre-renders a bounded list of ids and falls
  back to `1` when the contract cannot be read at build time. New ids are not
  generated on demand.
- **Runtime state goes in a query parameter, not a path.** `/m/?address=G…` is a
  single prebuilt page that reads the address after hydration. That is the
  pattern for any page whose subject is chosen at runtime — and it must be a
  `<Suspense>` boundary around `useSearchParams`, or the prerenderer fails.

## 2. Register the page

`src/lib/pages.json` is the one list of pages, and two things read it: the
metadata helper and the build step that draws the share image. Add an entry
with `title`, `description`, `path` (with the trailing slash) and `image`, then
export the metadata from the route's `layout.tsx` — the shape every existing
route already uses:

```tsx
import type { Metadata } from "next";
import { PAGES, pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata(PAGES.status);
```

A `layout.tsx` and not `page.tsx`, because a client page cannot export
`metadata`. `pageMetadata` builds the canonical link, the Open Graph card and
the Twitter card from `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_BASE_PATH`, so
nothing about the host is hardcoded. The image itself is drawn from the same
JSON before every build by `npm run og`; there is no second file to create.

If the page belongs in the header, add it to `NAV` in
`src/components/WalletLayoutInner.tsx`. That array feeds both the desktop and
the mobile navigation, and `isCurrent` decides the `aria-current="page"` state
— no per-page active logic.

## 3. Load the data

There are two sources and the page uses both, in this order.

**The indexer** — `api` from `src/lib/api.ts`. Every method is fail-soft and
returns `null` on a network error, a non-2xx response or a body that does not
parse. `null` means *this source cannot answer*, which is not the same as an
empty list, and the page has to say which one it means. `api.isConfigured()`
tells you whether the build even has a backend URL.

**The contracts** — `src/lib/chain.ts` (`chainPlansOf`, `chainMandatesOf`,
`chainMerchantSummary`, …) and `payflow` for a single object. These keep working
with the backend off; they are slower and capped, which is why the page says so
in a `Notice` rather than silently showing a short list.

The loader is a hook, even when it lives in the page file:

```tsx
type PageState =
  | { status: "loading" }
  | { status: "unavailable" }   // no backend, nothing on chain
  | { status: "error" }         // answered, but not readably
  | { status: "data"; data: Thing[] };

const loadId = useRef(0);

const load = useCallback(async () => {
  const id = (loadId.current += 1);
  setState({ status: "loading" });

  const res = await api.things(subject);
  // A wallet can switch accounts, or the page can be reloaded mid-flight: only
  // the newest request may write state, or a slow answer overwrites a new one.
  if (loadId.current !== id) return;

  if (res) {
    setState({ status: "data", data: res.things });
    return;
  }

  try {
    setState({ status: "data", data: await chainThings(subject) });
  } catch {
    setState({ status: "unavailable" });
  }
}, [subject]);

useEffect(() => {
  void load();
}, [load]);
```

Why a discriminated union and not `data | null` plus `loading`: the four states
render differently and the compiler should refuse to draw a table from a state
that has no data. `CohortRetentionTable` is the shortest complete example of the
shape, `src/app/m/` the same loader with a contract fallback, and
`src/app/merchant/page.tsx` the largest.

**Money never becomes a `number`.** Amounts arrive as decimal strings in the
token's smallest unit and stay `bigint` until they are printed. Use
`formatAmount`/`formatTokenValue` from `useI18n()` and `metaFor` with
`useTokenMetas` — a plan may be denominated in a token whose decimals are not
XLM's, and guessing 7 misprices it by a factor of 10^7.

**Writes** go through `payflow` from `@/lib/lazy-payflow` and are signed by the
wallet: `payflow.charge(address, signXdr, mandateId)`. Wrap them in the `run()`
helper the merchant page already uses — set busy, clear the two notices, run,
refresh on success, translate the error on failure — and disable the control
while `networkMismatch` is true. A write that fails should leave a sentence a
merchant can act on, never `Error(Contract, #7)`.

Shared hooks worth knowing before writing your own:

| Hook | Where | Use |
| --- | --- | --- |
| `useWallet()` | `src/lib/wallet.tsx` | address, connect/sign, `networkMismatch` |
| `useNetwork()` | `src/lib/network.ts` | the network in force and the switcher |
| `useTokenMetas(ids)` / `metaFor` | `src/lib/token.ts` | symbol and decimals for a token contract |
| `useXlmUsdPrice()` | `src/lib/price.ts` | the USD estimate shown beside an amount |
| `useStream({ address, role, onEvent })` | `src/lib/stream.ts` | live updates from the backend, when configured |

## 4. Text, colour and the accessible alternative

Application text belongs in `src/i18n/en.json` **and** `src/i18n/fr.json`; call
`tr("…")` from `useI18n()`. Merchant names, addresses, transaction hashes and
contract identifiers are never translated. `test/i18n-pages.test.tsx` renders the
four main pages in French, so a page that hardcodes English is caught by a test
once it is added there.

Colours come from the tokens in `src/app/globals.css` (`fg`, `soft`, `muted`,
`accent`, `danger`, `warn`, `info`, `edge`, `panel`, `ink`). A fixed Tailwind
palette class such as `text-slate-200` or `text-amber-300` is a bug: it does not
follow the theme, and `test/contrast.test.ts` fails on it. That test also asserts
every token pairing against WCAG AA in both palettes, so a new token has to be
measured before it ships.

A chart is not finished until it has a textual equivalent. `RevenueChart` carries
an accessible name summarising the series and the same figures as a real
`<table>` behind a disclosure; `CohortRetentionTable` prints a sentence
describing the grid above it and spells out each cell's meaning in `sr-only`
text, because a background tint and an `aria-label` on a bare `<span>` are not
announced. Follow one of those two shapes rather than inventing a third.

## 5. Stay inside the JS budget

`npm run budget` fails when a route's first-load JS exceeds its cap in
`js-budget.json`. A new route inherits `default`; if it needs its own cap, add
it in the same PR and say why in the PR body. Keep `@stellar/stellar-sdk` and the
wallet kit out of the route's static import graph — load them through
`@/lib/lazy-payflow` or `import()` at first use.

## 6. Test it

| What | Where | Notes |
| --- | --- | --- |
| Parsing, formatting, arithmetic | `test/<name>.test.ts` | Node environment; no DOM needed. This is where the edge cases belong — the pure function is the API. |
| A component or a page | `test/<name>.test.tsx` | Start the file with `// @vitest-environment jsdom` and render inside `I18nProvider`. |
| Contract or wallet dependencies | same file | `vi.mock` `@/lib/wallet`, `@/lib/api`, `@/lib/payflow` and `@/lib/chain`; `test/i18n-pages.test.tsx` mocks all four. |
| Rendered pixels | `e2e/visual.spec.ts` | Add the route to `PAGES`, then refresh the baselines as `docs/visual-regression.md` describes. |

Coverage is measured over `src/lib/**` against the thresholds in
`vitest.config.ts`, so a new loader in `src/lib/` needs tests, while a page that
only composes components does not move the number. Run the checks CI runs
(`npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and
`npm run budget`) before opening the PR; they are the same commands, in the same
order, in `.github/workflows/ci.yml`.
