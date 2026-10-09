# Changelog

All notable changes to payflow-frontend. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

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
