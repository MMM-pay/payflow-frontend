# Testing guide

Payflow tests are divided into three distinct layers: unit tests for pure logic
and protocol bindings, component tests for React UI and user flows, and end-to-end
(E2E) tests for visual regression and live on-chain protocol execution.

Every layer is deterministic, runnable locally, and runs in CI.

## Testing layers at a glance

| Layer | Environment | Runner | Target | What it tests |
|---|---|---|---|---|
| **Unit** | `node` | Vitest | `test/*.test.ts` | Pure functions, formatters, math, contract bindings, API client fail-soft logic |
| **Component** | `jsdom` | Vitest + RTL | `test/*.test.tsx` | UI rendering, user events, loading/empty/error states, accessibility, i18n, theme classes |
| **Visual E2E** | Chromium | Playwright | `e2e/visual.spec.ts` | Desktop (1280×720) and mobile (375×812) layout regression against committed snapshots |
| **Mocked-chain E2E** | Chromium | Playwright | `e2e/subscribe-mocked.spec.ts` | Subscribe flow with an injected keypair wallet and Soroban RPC mocked, including success, contract errors, on-chain failure and edge states |
| **Network E2E** | Chromium | Playwright | `e2e/local/flow.spec.ts` | Real Soroban contracts on a local Stellar network; end-to-end plan publication, deposit, subscription, and cancellation |

---

## 1. Unit tests (pure logic & protocol bindings)

Unit tests live in `test/*.test.ts` and run in Vitest's default `node` environment
without DOM emulation. They execute in milliseconds and have zero dependencies on
browsers or network sockets.

### What to test here

- **Stroop and financial math (`src/lib/format.ts`, `src/lib/discount.ts`):**
  Conversion between human decimals and smallest integer units (stroops). Verify
  that money operations remain strictly in `bigint` without floating-point drift.
  Test zero, extreme values, and negative amounts (e.g. refunds).
- **Protocol bindings and ScVal serialization (`src/lib/bindings.ts`, `src/lib/payflow.ts`):**
  Encoding of method arguments, error map translations (`ERRORS`), and contract
  record compatibility.
- **Backend client resilience (`src/lib/api.ts`, `src/lib/sync-lag.ts`):**
  Fail-soft semantics: API functions must return `null` or default fallbacks on
  network error, indexer downtime, or missing endpoints rather than throwing or
  crashing pages.
- **Utility logic (`src/lib/config.ts`, `src/lib/toml.ts`, `src/lib/calendar.ts`):**
  Parsing, URL generators, TOML resolution, and time conversions.

### What does NOT belong here

- DOM queries, React hooks, or rendered JSX.
- Hardcoded real wallet keys or live RPC calls.

### Running unit tests locally

```bash
# Run all unit and component tests with coverage
npm test

# Run a specific unit test file
npx vitest run test/format.test.ts

# Run matching tests in watch mode during development
npm run test:watch test/sync-lag
```

### Coverage requirements

CI enforces coverage over `src/lib/**` via `vitest.config.ts`. Thresholds are
strictly enforced:

- **Statements / Lines:** ≥ 80%
- **Branches:** ≥ 90%
- **Functions:** ≥ 77%

Any change that drops coverage below these thresholds fails the `test` CI check.

---

## 2. Component tests (React & UI interaction)

Component tests live in `test/*.test.tsx` and run under `jsdom`. Every component
test file must include `// @vitest-environment jsdom` as its first line.

Component tests use `@testing-library/react` and `@testing-library/dom` to drive
components from the user's perspective.

### What to test here

- **The four essential states:**
  Every component and page view must explicitly handle and test:
  1. **Loading state:** Skeletons, spinners, or placeholder rows with `aria-busy="true"`
     or accessible announcements (e.g. `Loading amount…`, `role="status"`).
  2. **Empty state:** Meaningful empty indicators when lists or balances are empty
     (e.g. `—`, "No active subscriptions", "No deliveries yet").
  3. **Error state:** Accessible error callouts (`role="alert"`), invalid input
     handling, and fail-soft fallbacks when RPC or indexer data fails.
  4. **Active / Success state:** Correct formatting, badges, and feedback notices.
- **Accessibility & ARIA semantics:**
  Verify accessible names (`aria-label`, visible text labels), semantic roles
  (`button`, `status`, `alert`, `dialog`), and keyboard navigation. See
  [docs/accessibility.md](accessibility.md).
- **Internationalization (i18n):**
  Ensure components render through `I18nProvider` without raw missing keys, and
  test that localized strings (e.g. French in `src/i18n/fr.json`) render properly.
- **Theme awareness:**
  Verify that status elements apply appropriate theme tokens (e.g. `text-danger`,
  `text-accent`, `border-warn/40`, `bg-warn/10`) rather than hardcoded colours.
- **Subscriber portal (`/account`) & Merchant dashboard (`/merchant`):**
  - Subscriber portal: Vault deposit/withdraw forms, mandate pause/cancel buttons,
    balance displays, and transaction history.
  - Merchant dashboard: Plan creation, manual mandate settlement, refund forms,
    and webhook history controls.

### Writing a component test

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Money } from "@/components/Money";
import { I18nProvider } from "@/lib/i18n";

describe("Money component", () => {
  it("renders zero without a minus sign", () => {
    render(
      <I18nProvider>
        <Money amount={0n} meta={{ symbol: "XLM", decimals: 7 }} />
      </I18nProvider>
    );
    expect(screen.getByText("0 XLM")).toBeInTheDocument();
  });

  it("renders loading skeleton with status role", () => {
    render(
      <I18nProvider>
        <Money loading={true} />
      </I18nProvider>
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });
});
```

### Running component tests locally

```bash
# Run all component tests
npx vitest run test/*.test.tsx

# Run a specific component or page test suite
npx vitest run test/money.test.tsx
npx vitest run test/merchant-page.test.tsx
npx vitest run test/account-page.test.tsx
```

---

## 3. End-to-end tests (Playwright)

Payflow maintains three distinct E2E suites depending on whether a live
blockchain is required.

### 3A. Visual regression suite (`e2e/visual.spec.ts`)

Screenshots every statically exported page at two standard viewports:
- **Desktop:** 1280 × 720
- **Mobile:** 375 × 812

Pages render from contract-only state: Soroban RPC is mocked with deterministic
values (`e2e/mock-rpc.ts`) and all external network calls are blocked. No wallet
is connected, and no indexer or network is required.

#### How to run locally

```bash
# Install Playwright browser dependencies (once per machine)
npx playwright install --with-deps chromium

# Build static export with deterministic footer metadata and mock RPC URL
npm run build:visual

# Run visual regression tests against committed snapshots
npm run test:visual

# Update snapshots when intentional UI changes are made
npm run test:visual -- --update-snapshots
```

For complete details on screenshot diffing thresholds and CI container matching,
see [docs/visual-regression.md](visual-regression.md).

---

### 3B. Mocked-chain subscribe suite (`e2e/subscribe-mocked.spec.ts`)

Drives the subscribe page in Chromium with a wallet and the whole RPC lifecycle
mocked. The build enables `NEXT_PUBLIC_E2E_WALLET`, the test injects a fixed
keypair before the app boots, and `e2e/mock-rpc.ts` answers simulations,
submission and polling with deterministic XDR. No extension, indexer, Horizon
instance, Docker container or live network is involved.

The suite covers the successful mandate, a contract rejection before signing,
an on-chain failure after submission, a wallet on the wrong network, a missing
wallet, an invalid charge limit, and cancelling the confirmation dialog. It
runs with the same `npm run build:visual` + `npm run test:visual` commands as
the visual suite.

---

### 3C. Local network integration suite (`e2e/local/flow.spec.ts`)

Drives the static export against real Payflow contracts deployed on a local
Stellar standalone network container (`stellar/quickstart`).

Unlike the visual suite, this suite uses **no mocks**. It tests real blockchain
state transitions through the protocol:

1. **Merchant publishes plan:** Submits `create_plan` transaction and confirms on-chain.
2. **Subscriber deposits into vault:** Submits `deposit` to the vault contract.
3. **Subscriber opens mandate:** Submits `subscribe` and verifies `["Active"]` state.
4. **Subscriber cancels mandate:** Submits `cancel` and confirms `["Cancelled"]` badge.

#### How to run locally

Docker is required for the local Stellar quickstart container.

```bash
# 1. Install Playwright Chromium
npx playwright install chromium

# 2. Start standalone local Stellar network
docker run --rm -d --name stellar-local -p 8000:8000 \
  stellar/quickstart:latest --local --limits unlimited

# 3. Deploy contracts and write .e2e/contracts.json
node e2e/local/deploy-contracts.mjs

# 4. Export environment variables and build static export
eval "$(node e2e/local/export-env.mjs --shell)"
npm run build

# 5. Run the local network E2E test suite
npx playwright test --config playwright.e2e.config.ts

# 6. Stop the container when done
docker rm -f stellar-local
```

See [e2e/local/README.md](../e2e/local/README.md) for deeper details on ephemeral
keys, funding test accounts, and the `NEXT_PUBLIC_E2E_WALLET` test wallet module.

---

## 4. Performance budgets

The Lighthouse workflow measures each route listed in `lighthouserc.json` and
fails if its Largest Contentful Paint exceeds that route's budget. The
reference CI run measured:

| Route | Measured LCP | Budget |
|---|---:|---:|
| `/` | 1,973 ms | 2,500 ms |
| `/account/` | 3,017 ms | 3,500 ms |
| `/m/` | 2,874 ms | 3,300 ms |
| `/mandates/` | 2,120 ms | 2,500 ms |
| `/merchant/` | 2,119 ms | 2,500 ms |
| `/plans/1/` | 4,268 ms | 4,800 ms |
| `/receipt/` | 1,965 ms | 2,500 ms |
| `/status/` | 1,817 ms | 2,500 ms |
| `/subscribe/` | 3,200 ms | 3,600 ms |

Budgets are route-specific so a regression on one page cannot be hidden by
another page's result. The build CI job also runs `npm run budget`, which
reports and enforces the gzip first-load JavaScript cap for every exported
route in `js-budget.json`.

---

## Which layer should I write for my change?

| Your change | Recommended test layer | Key considerations |
|---|---|---|
| New calculation, parsing, or token formatting | **Unit (`test/*.test.ts`)** | Must handle `bigint` stroops, zero, negative/refunds, invalid inputs. Check coverage thresholds. |
| New UI component or page section | **Component (`test/*.test.tsx`)** | Test loading, empty, error, and active states. Verify accessibility roles, labels, and theme tokens. |
| Dashboard feature in `/account` or `/merchant` | **Component (`test/*.test.tsx`)** | Mock contract/indexer calls, verify buttons, form validations, notices, and i18n strings. |
| Global layout, typography, or styling changes | **Visual E2E (`e2e/visual.spec.ts`)** | Run `npm run build:visual && npm run test:visual`. Update snapshots if visual changes are intentional. |
| UI-level wallet signing flow, confirmation and error states | **Mocked-chain E2E (`e2e/subscribe-mocked.spec.ts`)** | Keep deterministic with the injected keypair and mocked RPC; no network or Docker needed. |
| Contract call sequencing against real deployed code | **Local Network E2E (`e2e/local/flow.spec.ts`)** | Add steps to `e2e/local/flow.spec.ts` to test the full lifecycle on a standalone Stellar network. |
