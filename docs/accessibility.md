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

## Data and charts

- [ ] Charts carry an `aria-label` summarising range, total and peak, and expose
      the same figures as a real table behind a disclosure.
- [ ] Amounts are formatted with `formatAmount`/`fromStroops`; never a float.
- [ ] Money is `bigint` end to end.

## Testing

- [ ] Add a component test covering the accessible name and the empty/error
      states.
- [ ] Keep tests deterministic: no real network or wallet.

See also [docs/visual-regression.md](visual-regression.md) and [docs/testing.md](testing.md).
