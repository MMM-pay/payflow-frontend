# Changelog

All notable changes to payflow-frontend. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

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

- **Accessible dialog primitive.** `Dialog` in `src/components/ui.tsx` moves
  focus into the panel when it opens, keeps it inside while the dialog stays
  open, closes on Escape or its own dismiss button, and hands focus back to
  whatever opened it. The panel is labelled by its title through `aria-modal`
  and `aria-labelledby`, so a screen reader announces what is being confirmed
  before any action. Confirmations are inline buttons today and the account
  page falls back to `window.confirm`, which cannot be styled, labelled, or
  kept in reach on a phone; this is the primitive those calls switch to. It
  holds no data of its own, so it behaves the same with and without
  `NEXT_PUBLIC_API_URL` configured and in contract-only mode.
- **Pause until a date on the account page.** A subscriber can choose the day
  billing resumes, and a paused mandate shows that date. The control is hidden
  unless the mandate data carries `pause_until`, so a deployed contract that
  predates the field — including the current testnet deployment — never offers
  a write it cannot service. Built against the interface proposed in
  payflow-contract#41; the indexer must serve the field for the control to
  appear when a backend is configured.
- **Light theme with a system default.** Both palettes are exposed as CSS
  variables, the page follows `prefers-color-scheme` unless the reader chooses
  Light or Dark from the header, and the choice is saved in `localStorage`. A
  pre-paint script applies a stored choice so the wrong theme never flashes.
- **Upcoming charges timeline on the account page.** Each active mandate shows
  its next six charges, the running total, the final charge date when capped,
  and a warning when the vault cannot cover the next charge. Built from the
  mandates and vault balance already on the page, so it also works in
  contract-only mode.
- **Merchant discounts on a mandate.** A merchant can attach a discount to one
  of their mandates — a percentage and the number of charges it covers — and
  the subscriber sees the discounted price and how many discounted charges are
  left. The rate is a whole number of basis points, and the amount is computed
  in the token's smallest unit, so the price shown is the price charged.
  Built against the interface proposed in payflow-contract#37 and hidden
  entirely — including the merchant's control — while the deployed contract
  cannot carry the field.

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
