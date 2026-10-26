# Visual regression tests

`e2e/visual.spec.ts` screenshots every statically exported page at two
widths — desktop 1280x720 and mobile 375x812 — and compares the result with
baselines committed under `e2e/__screenshots__/`. A style change that breaks
a layout fails the `visual` CI check instead of reaching the demo.

The pages render from contract-only state: Soroban RPC is mocked with canned
contract values (`e2e/mock-rpc.ts`) and every other external request is
blocked, so the screenshots need no wallet, no payflow-backend and no
network, and look the same on every machine.

## Running locally

```bash
npm ci
npx playwright install --with-deps chromium   # once per machine
npm run build:visual                          # static export into out/
npm run test:visual                           # compares against the baselines
```

`build:visual` pins `NEXT_PUBLIC_APP_VERSION` and `NEXT_PUBLIC_COMMIT_HASH`
so the footer is identical in every build, and points
`NEXT_PUBLIC_SOROBAN_RPC_URL` at `https://rpc.visual.test`, the host the mock
intercepts.

## Updating the baselines

Baselines change only when a visual change is intended:

1. Run `npm run build:visual`.
2. Run `npm run test:visual -- --update-snapshots`.
3. Review every changed PNG under `e2e/__screenshots__/` the way you would
   review a diff — each one is the change you meant to make.
4. Commit the updated baselines with the change that caused them.

If CI fails and the diff is a false positive (the CI runner's font rendering
shifting by a hair), the failed run's `visual-results` artifact contains the
actual and diff images. Refresh the baselines from that artifact with the
same three steps above rather than editing PNGs by hand.

## Thresholds

`playwright.config.ts` compares with `maxDiffPixelRatio: 0.02` and a
per-pixel colour `threshold` of `0.2`. That absorbs antialiasing and font
hinting noise — a shifted or reflowed layout moves far more than 2% of the
pixels at either width, so a real break still fails. If a page gains a large
legitimately animated or time-dependent region, mask it in the spec rather
than raising the ratio.

## CI

The `visual` job in `.github/workflows/ci.yml` runs inside
`mcr.microsoft.com/playwright:v1.64.1-jammy`, the same image the baselines
are expected to match, so fonts line up however the runner is provisioned.
Keep the image tag in sync with the `@playwright/test` version in
`package.json`. On failure the job uploads `test-results/` (actual and diff
images) as the `visual-results` artifact.
