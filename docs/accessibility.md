# Accessibility checklist for new components

Run through this before opening a PR that adds or changes a component. It is the
short version of the WCAG 2.1 AA expectations the rest of the app already
follows; if a component fails one of these, fix it in the same PR rather than
filing a follow-up.

## Structure

- [ ] Use semantic elements (`button`, `a`, `nav`, `main`, `section`, `table`,
      `details`) before reaching for `div`/`span` with roles.
- [ ] Heading levels are sequential and there is exactly one `h1` per page.
- [ ] Lists use `ul`/`ol`/`li`; data grids use a real `table` with `th scope`.
- [ ] Modals/dialogs use the native `dialog` element or `role="dialog"` with
      `aria-modal="true"` and a labelled title.

## Keyboard

- [ ] Every interactive element is reachable with Tab and activatable with
      Enter/Space.
- [ ] Focus is visible: rely on `focus-visible:ring-*` utilities, never remove
      the outline without a replacement.
- [ ] Focus order follows the visual order; no positive `tabindex`.
- [ ] Escape closes overlays and returns focus to the trigger that opened them.
- [ ] No keyboard trap; the reader can leave any component with Tab.

## Names and state

- [ ] Icon-only buttons carry an `aria-label` (or visible text).
- [ ] Form controls have an associated `label` (visible or `sr-only`).
- [ ] Dynamic regions that update without a navigation use `aria-live` (polite
      for status, assertive only for errors).
- [ ] Loading/empty/error states are announced, not just visually swapped.
- [ ] Disabled controls use the `disabled` attribute, not just styling.

## Visual

- [ ] Text contrast is at least 4.5:1 against its background in both themes.
- [ ] Information is not conveyed by colour alone; pair colour with text or icon.
- [ ] `prefers-reduced-motion` is respected — no essential animation, and the
      `useReducedMotion` hook disables transitions.
- [ ] The component works at 200% zoom and on a 320 px viewport.
      `e2e/reflow.spec.ts` checks every route at 640 CSS px (200% zoom on a
      1280 px window) and at 320 CSS px (the WCAG 1.4.10 floor): the document
      itself must not scroll sideways. Wide tables may scroll **inside** their
      own labelled `role="region"` container, which must also be keyboard
      focusable (`tabIndex={0}`) so a keyboard user can reach the columns.

## Data and charts

- [ ] Charts carry an `aria-label` summarising range, total and peak, and expose
      the same figures as a real table behind a disclosure.
- [ ] Amounts are formatted with `formatAmount`/`fromStroops`; never a float.
- [ ] Money is `bigint` end to end.

## Linting

`npm run lint` runs the full recommended set from `eslint-plugin-jsx-a11y` as
errors (issue #389), on top of `eslint-config-next`. The rules that catch the
regressions this checklist describes are therefore enforced in CI, not just
documented:

- `alt-text`, `anchor-has-content`, `anchor-is-valid`, `heading-has-content`
- `aria-*`, `role-has-required-aria-props`, `role-supports-aria-props`
- `label-has-associated-control`
- `click-events-have-key-events`, `no-static-element-interactions`,
  `interactive-supports-focus`, `mouse-events-have-key-events`
- `no-autofocus`, `no-distracting-elements`, `no-redundant-roles`, `scope`,
  `tabindex-no-positive`

Two deliberate configuration choices to know about:

- **`no-noninteractive-tabindex` allows `role="region"` and `role="feed"`.**
  A scroll container has to be focusable for a keyboard user to scroll it
  (WCAG 2.1.1), so the labelled, focusable scroll region is allowed. Every such
  container needs `role="region"`, an `aria-label`, and `tabIndex={0}`; the
  virtualised list uses `role="feed"` for the same reason.
- **A mouse-only overlay may use `role="presentation"`.** The dialog backdrop
  closes the dialog on click; Escape and the labelled close button are the
  accessible paths, and the backdrop itself carries no semantics.

A new rule that fires on intentional, correct markup should be discussed in the
PR — do not add an `eslint-disable` comment to silence it.

## Testing at 200% zoom

```bash
npm run build:visual          # static export the Playwright suites serve
npx playwright test e2e/reflow.spec.ts
```

The suite fails with the page's overflow in pixels and the widest offending
element, so a regression names itself. It is part of the `visual` CI job.

For the manual half of issue #377, with the app running in a browser:

1. Zoom to 200% (`Ctrl`/`Cmd` + `+` twice) and confirm nothing is clipped or
   hidden; text wraps instead of being cut off.
2. Tab through the page: the first stop is "Skip to content", then the header,
   then the page. A wide table is reachable with Tab and scrolls with the arrow
   keys; focus is visible on it.
3. With a screen reader (VoiceOver, NVDA or Orca), confirm the skip link is
   announced first, each table is announced with its caption, and validation
   errors are announced through their `role="alert"`.

## Testing

- [ ] Add a component test covering the accessible name and the empty/error
      states.
- [ ] Keep tests deterministic: no real network or wallet.

See also [docs/visual-regression.md](visual-regression.md) and [docs/testing.md](testing.md).
