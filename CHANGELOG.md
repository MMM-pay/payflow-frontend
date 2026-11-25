# Changelog

All notable changes to payflow-frontend. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- **Charts and retention grids now carry a textual equivalent (#318).**
  `RevenueChart` already shipped an accessible summary and a real `<table>`;
  the cohort retention grid only encoded its figures as percentage text and a
  background tint, and an `aria-label` on a bare `<span>` is ignored by several
  screen readers. The grid now prints a sentence above the table — cohort count,
  signup range, subscribers covered and the month-1 spread — uses that sentence
  as its caption, and spells out each cell (`1 in the signup month`, `75%
  retained after 2 months`, `Data not yet available`) in `sr-only` text.
  `describeCohortRetention` is a pure function in `src/lib/cohort-retention.ts`
  with tests, so the wording is checked without a browser.

- **A page-authoring guide for contributors (#390).**
  `docs/adding-a-page.md` documents the pattern end to end: the route
  directory and the static export's constraints (trailing slashes,
  build-time dynamic segments, `<Suspense>` around `useSearchParams`), the
  `pages.json` entry and the `layout.tsx` that exports `metadata`, the loader
  hook with its request guard and four-state union, the indexer-then-contract
  fallback, the `run()` write pattern, the i18n catalogues, the JS budget and
  the tests. `CONTRIBUTING.md` and `README.md` link to it from where a
  contributor looks for it.

### Fixed

- **Text no longer drops below WCAG AA in one theme (#317).** Several
  components bypassed the theme tokens with fixed palette colours, so their text
  was near-invisible in the other theme: `text-slate-200`/`text-slate-300` on the
  empty state, the receipt card and the receipt's transaction-proof label (a
  near-black-on-near-white problem in light mode), `text-amber-300` on the
  balance warning and the status page's degraded check, `text-rose-200/300` on
  inline form errors, `text-emerald-500`/`text-amber-500` on the subscribe
  guide's step label, and `text-muted/80` on the receipt footer. Each now uses
  `soft`, `warn`, `danger`, `accent` or `muted`, all of which are defined for
  both palettes and measured at AA. White text on `bg-accent` (two dashboard
  tabs and the danger count pill) became `text-ink`/`bg-danger-solid`, because
  `--accent` is a light green in dark mode and `--danger` a pale pink: white on
  either was the lowest-contrast pair on the page. The retention grid's five
  `bg-green-100 dark:bg-…` bands became tints of `accent`, `warn` and `danger`,
  since `dark:` follows the OS preference rather than the theme the reader
  chose. `src/lib/contrast.ts` adds the WCAG maths and `test/contrast.test.ts`
  reads the palettes out of `globals.css` and asserts every text/surface,
  status-tint, badge and focus-ring pairing at AA (4.5:1 normal text, 3:1 for
  the ring), and fails on any new fixed-palette colour outside a `print:`
  variant.

### Performance

- **Preconnect to the RPC, Horizon and indexer origins (#330).** The first
  contract read or indexer fetch otherwise paid for DNS, TCP and TLS in series
  with the page render. `src/app/layout.tsx` now emits `rel="preconnect"` links
  for the configured origins, with `crossorigin` so the warm socket is the one
  the CORS fetch can reuse, and `src/lib/preconnect.ts` reduces each URL to an
  origin, deduplicates and skips empty or non-http values so a contract-only
  build emits nothing. The hints are static markup: no JavaScript is added to
  any route, so the first-load budgets are unchanged. The Lighthouse budget job
  in `.github/workflows/lighthouse.yml` runs against the export on every pull
  request and is the measurement for this change.

### Changed

- **Next.js 15 → 16, React 19.0 → 19.3 (#80).** Turbopack is now the default
  bundler for `next dev` and `next build`. The static export, the
  `/payflow-frontend` base path and contract-only mode are unchanged: the build
  was re-verified both plain and with `NEXT_PUBLIC_BASE_PATH` set and
  `NEXT_PUBLIC_API_URL` empty, and every exported asset and link carries the
  base path. `eslint.config.mjs` now consumes the flat configs shipped by
  `eslint-config-next` 16, so the `FlatCompat` bridge and the unused
  `@eslint/eslintrc` dependency are gone. Two rules that
  `eslint-plugin-react-hooks` 7 introduces (`set-state-in-effect`, `purity`)
  are set to `warn` until the data-loading refactor in #185 — complying with
  them means rewriting how every page loads data, not fixing this upgrade. The
  `refs` violations they also surfaced (ref mirrors written during render) are
  fixed in code.

### Fixed

- **A successful contract read never released its concurrency slot.**
  `readContract` takes one of six permits before each simulation, but the
  success path returned while still holding it, so the seventh read after any
  six successful reads waited forever and the page stopped loading. Permits are
  now released in a `finally`, and the backoff sleep no longer holds one.
- **The publish form accepted any text as a price** and only failed once the
  transaction was simulated, so a merchant paid for a failed attempt. The
  price is validated inline — positive, at most 7 decimal places — and Publish
  stays disabled with a message until it is usable.

### Changed

- **Plans are cached for the session instead of re-read on every visit.** A
  plan's name, price, period, token and trial are frozen after `create_plan`,
  so only the `active` flag expires (after 30 seconds); a merchant's own
  `set_plan_active` drops that plan immediately. Token symbol and decimals were
  already cached indefinitely. In contract-only mode — the public demo, which
  has no indexer — the subscribe list drops from 10 RPC calls to 2 on a second
  visit inside the window at the live registry's 4 plans, and from 50 to 2 at
  the 24-plan list cap. Each read costs a `getAccount` and a simulation, so a
  visit is `2 * (1 + plans)` and a repeat is just the `next_plan_id` read; the
  unit test asserts both counts on fixed 4- and 24-plan contracts.

### Added

- **A loading button for async writes (#413).** `LoadingButton` shows a
  spinner, announces `aria-busy`, and refuses a second click synchronously —
  ahead of React applying `disabled` — so a double click cannot open the same
  wallet prompt or submit the same write twice. The subscribe deposit and
  subscribe actions and the account deposit, withdraw and sponsor controls use
  it.

- **Contract-version drift is reported instead of silently ignored (#412).**
  `src/lib/contract-compat.ts` compares decoded plans and mandates against the
  fields and statuses this build knows. A newer contract is announced with an
  informational notice on the subscribe, account and merchant pages; unknown
  fields are ignored and an unknown status is shown verbatim, so the rest of
  the page keeps working. Unmapped contract error codes count as drift too.

- **Deposits can be entered in periods or token units (#408).** The subscribe
  page's vault funding form keeps both fields in sync at the plan price:
  editing periods fills the amount, and editing the amount derives the whole
  periods it covers (rounded down). Integer conversions live in
  `src/lib/deposit-amount.ts`; invalid drafts disable the deposit and explain
  why.

- **One confirmation dialog for the whole app (#407).** `ConfirmDialog` fixes
  the title to a question, puts the safe "Cancel" first and the committing
  action last, and uses a danger label only for irreversible actions. The
  subscribe confirmation, merchant "Deactivate all plans" and account "Cancel
  all" flows use it; inline confirmations on the mandates page now follow the
  same order.

- **Side-by-side plan comparison on the subscribe page (#175).** Tick up to
  three plans and open a table covering price, billing period, 30-day monthly
  equivalent, free trial, remaining seats and merchant. The monthly figure is
  pure bigint arithmetic in `src/lib/compare.ts` — never floating point — and
  the table is a real `<table>` with column and row headers plus a labelled,
  focusable scroll region for 375px screens. It works from whichever plan list
  the page loaded, so contract-only mode needs no backend.

- **Opt-in browser reminders before a charge (#174).** A "Remind me" button on
  each active subscription asks for notification permission only on that
  click, stores the choice per wallet address, and notifies a day before the
  next charge. Where the browser supports Notification Triggers the installed
  service worker holds the schedule; otherwise the page does so while it is
  open, which the panel explains. Cancelled and completed mandates lose their
  reminder, including statuses decoded as `["Cancelled"]` from contract state.
  Scheduling and preference logic is pure in `src/lib/reminders.ts`.

- **Custom billing periods on the publish form.** The five presets stay, and a
  Custom option takes a number of days, weeks or months (30-day months, the
  same seconds the Monthly preset uses) for merchants billing fortnightly or
  quarterly. The count is converted to whole seconds and checked against the
  contract's 60-second floor — with the contract's own wording — before
  Publish is enabled, so a period `create_plan` would reject never reaches the
  wallet. Pure logic in `src/lib/period.ts`; works in contract-only mode
  because the period is local form state. `formatPeriod` already renders the
  custom lengths on plan cards ("every 2 weeks", "every 3 months").

- Subscribe cards show optional availability cutoffs and remaining seats, and
  reject expired/full plans before signing. Unlimited/legacy plans stay unchanged.
  Built against payflow-contract#26 (`available_until`, Unix seconds; 0 forever)
  and #25 (`max_subscribers`, 0 unlimited). Proposed integration: the indexer
  projects `subscriber_count` (open mandates, including paused); the subscription
  contract exposes `plan_subscriber_count(plan_id: u64) -> u32`. Those dependencies
  remain unshipped: absent fields hide the display, and unavailable counts are
  explained without inventing seats. Confirm the getter/projection when #25 lands.

- **Free trials on plans.** A "N-day free trial" badge on plan cards, the date a
  subscriber's trial ends on the account page, and a trial length in the
  subscribe confirmation. Built against the interface proposed in
  payflow-contract#9 and hidden entirely — including the merchant's control —
  while the deployed contract cannot carry the field.
- **Fee split preview on the publish form.** "Subscriber pays X · protocol fee Y
  (Z%) · you receive W", read live from the contract's `fee_bps` and computed in
  bigint exactly as `charge` does. If the rate cannot be read the form still
  works and previews a 0% split.
- **Upcoming charges calendar.** The account page can download an `.ics` file
  containing the next charge of every active mandate, with a recurrence bounded
  by the mandate's charge cap. Works in contract-only mode because the file is
  generated in the browser from the mandates already on screen.
- **Copy buttons for addresses and transaction hashes.** Both copy the full
  value rather than the shortened text, with the result announced through a
  live region.
- **Mobile navigation menu.** Below the `md` breakpoint the header links
  collapse into a menu button with `aria-expanded`, Escape-to-close and focus
  management.
- **Skeleton loading states** for plan cards, mandate rows and dashboard stats.
  The pulse is disabled when the user prefers reduced motion.

### Changed

- **Wallet pages ship about half the first-load JS they used to.** The Stellar
  SDK (~570 kB raw) now loads on demand — the first chunk that talks to the
  chain arrives after first paint instead of before it. Next's own report:
  `/account` 238 → 121 kB, `/m` 239 → 122 kB, `/subscribe` 240 → 123 kB,
  `/merchant` 244 → 127 kB, `/plans/*` 239 → 122 kB. The wallet kit was already
  loaded on first connect. Session restore, contract-only mode and every
  write path are unchanged; only when the code arrives moved. A new CI step
  (`npm run budget`) fails any build where a route's first-load JS grows past
  the budget in `js-budget.json`.
- **Cancelling a subscription now asks for confirmation.** The account page
  shows Keep and Confirm after the first Cancel click, matches the merchant's
  End flow, and allows only one mandate to be confirming at a time.

## [0.2.0] - 2026-10-09

Points at the v0.2.0 contract suite on testnet.

### Fixed

- **The demo misread every mandate's status.** Contract state decodes a
  `MandateStatus` as `["Active"]`, not `"Active"`, so on the contract-only path
  (the public demo, which has no backend) every `status === "Active"` check was
  false. "Charge now" never appeared, the merchant's active count was 0, and
  Pause sent a resume, which the contract rejected.
- **A failed charge blamed the wrong person.** When the subscriber's vault
  could not cover a charge, the vault's error #4 reached the page through
  `charge` and was shown as "You are not the subscriber on this mandate". It
  now says the vault does not hold enough. A missing plan during `subscribe`
  is reported as such instead of "That subscription does not exist".
- Wallet context hook dependencies: `signXdr` is now part of the memoised
  context value, and a stale dependency on a module function is gone.
- `npm run lint` could not run (Next's `next lint` with no ESLint config). It
  now runs ESLint 9 with `eslint-config-next`, and CI enforces it.

### Added

- Merchants can end a subscriber's mandate from the dashboard, with a second
  click to confirm because it is permanent. Subscribers see when a merchant
  ended a mandate.
- The contract-only fallback reads the paged indexes from the v0.2.0
  contracts and lists the newest plans using `next_plan_id`, instead of
  probing ids 1 to 24.
- The Pages build reads the backend URL from the `NEXT_PUBLIC_API_URL`
  repository variable, so connecting a deployed backend needs no code change.

### Changed

- `@stellar/stellar-sdk` 13 → 17, for testnet's current protocol.
- 50 → 60 tests.

## [0.1.0] - 2026-09-02

Merchant dashboard and subscriber portal for the first testnet deployment.

[0.2.0]: https://github.com/MMM-pay/payflow-frontend/releases/tag/v0.2.0
