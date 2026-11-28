# Components, hooks and state

This guide explains where UI and stateful logic belong in the merchant
dashboard and subscriber portal. For a route-specific walkthrough, see
[Adding a page](adding-a-page.md); for test selection and commands, see the
[testing guide](testing.md).

## Where code goes

| Location | Responsibility |
| --- | --- |
| `src/app/<route>/` | Route composition, page-specific state and sections used only by that route. Keep route metadata in `layout.tsx`. |
| `src/components/` | UI reused across routes, or a substantial section whose behavior is easier to understand and test on its own. |
| `src/lib/` | API and contract access, reusable hooks, and pure domain logic that does not render UI. |
| `src/i18n/` | Translation provider, formatting and the English and French catalogues. |

Keep a small, route-specific component beside its page when extracting it
would only move code around. Move it to `src/components/` when another route
needs it or its UI behavior benefits from a focused component test. Components
can own UI details such as an open panel, selected tab or in-progress button;
pass data and callbacks in props when a parent owns the workflow.

## Client boundaries

Pages are server components by default. Add `"use client"` only for browser
APIs, React state or effects, event handlers, or hooks that require a client.
Most data-driven routes are client components because their data loads after
hydration. Keep the client boundary at the route or the smallest interactive
subtree that can own it; `src/lib/` is not a place to hide a client boundary.

The root layout provides `I18nProvider`, `ToastProvider`, and `WalletProvider`.
Use their existing hooks (`useI18n()`, `useToastHook()`, `useWallet()`) rather
than creating a second copy of app-wide state. Put state in a new context only
when multiple distant parts of the app need the same live value and it belongs
to the whole app, as wallet and language state do.

## Loading and request state

Keep state with the page or section that fetches the data. A small,
one-off request can live in the page; extract a hook when its loading behavior
is reused or has enough lifecycle logic to deserve a name. Keep parsing,
formatting and calculations as pure functions in `src/lib/` so they can be
tested without rendering React.

Represent mutually exclusive request outcomes with a discriminated union,
rather than a nullable data field plus loosely related booleans:

```ts
type Result<T> =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "data"; data: T };
```

Render each state intentionally: loading feedback, a useful error with a
retry when appropriate, an unavailable explanation when the source cannot
answer, and a distinct empty state for successful data with no rows. In this
app, `api` in `src/lib/api.ts` reads the indexer and returns `null` when it
cannot answer; use contract reads from `src/lib/chain.ts` as a fallback only
where that data is available. An empty array is a valid answer, not a signal
to fall back. The page-authoring guide shows the request guard and complete
indexer-to-contract pattern.

When a request can outlive the inputs that started it (for example, a wallet
account switch), prevent its stale result from replacing newer state. Follow
the request-id/ref pattern in `docs/adding-a-page.md`. For live backend
updates, reuse `useStream()` in `src/lib/stream.ts` rather than opening a
separate event stream in a component.

## Actions and derived state

Keep temporary interaction state local: form values, selected rows, open
dialogs and pagination belong to the component or route that uses them. Derive
values from existing data when possible instead of storing a second copy that
can drift.

For asynchronous writes, disable duplicate submissions, show progress, and
surface a translated, actionable failure. Reuse `useAction()` in
`src/lib/useAction.ts` for keyed busy/error/done state, or follow the
merchant page's `run()` pattern when the operation also needs to refresh page
data or update notices. Contract writes go through the wallet-backed
`@/lib/lazy-payflow`; do not optimistically show success before the write
completes.

## Shared component behavior

Prefer a focused component API: data and callbacks in, rendered UI out. Keep
domain policy in `src/lib/` rather than duplicating it across page components.
Reuse the primitives in `src/components/ui.tsx` for panels, loading rows,
empty states and notices so pages give loading, error and empty states a
consistent shape.

Use `useI18n()` for user-facing text, theme tokens for color, and semantic
elements and accessible names for controls and sections. Async controls should
announce progress and prevent duplicate actions; `LoadingButton` is the
existing example. See the [accessibility checklist](accessibility.md) before
adding or changing interactive UI.

Keep browser-only dependencies and heavy visualizations out of a route's
initial bundle where appropriate. Follow the dynamic-import examples in the
merchant page for browser-only widgets, and use `@/lib/lazy-payflow` for the
SDK-backed contract client.

## Tests

Test pure domain logic in `test/*.test.ts`; test rendered states and user
interactions in `test/*.test.tsx`. A data-driven section should cover loading,
empty, error or unavailable, and successful states as applicable. Render
components inside `I18nProvider`, and mock wallet, API and contract boundaries
so tests do not depend on a live wallet or backend. See
[`docs/testing.md`](testing.md) for the full conventions.
