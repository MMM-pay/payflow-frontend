import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #315: every interactive element must have a clear, theme-aware focus ring.
 *
 * jsdom does not apply stylesheets, so the meaningful automated check is on
 * the stylesheet itself: a single base rule must cover links, buttons and
 * form controls, paint from a theme token (not a hardcoded colour), and stay
 * at zero specificity so component-level `focus-visible:ring-*` utilities can
 * still override it. Component behaviour (focus movement, keyboard handlers)
 * is covered by the component tests that already exercise each control.
 */

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** The body of the base `:focus-visible` rule added for issue #315. */
function focusRule(): string {
  const match = css.match(
    /@layer base \{[\s\S]*?:focus-visible \{([\s\S]*?)\}\s*\}/,
  );
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

describe("global focus-visible styles (#315)", () => {
  it("covers links, buttons, inputs and other focusable controls", () => {
    const rule = css.match(/@layer base \{[\s\S]*?:focus-visible/)?.[0] ?? "";
    for (const selector of [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "summary",
      '[tabindex]:not([tabindex="-1"])',
    ]) {
      expect(rule).toContain(selector);
    }
  });

  it("uses the zero-specificity :where() wrapper so component rings win", () => {
    expect(css).toMatch(/:where\([\s\S]*?a\[href\][\s\S]*?\):focus-visible/);
  });

  it("paints the ring from the theme accent token in both themes", () => {
    const body = focusRule();
    expect(body).toContain("outline: 2px solid rgb(var(--accent))");
    expect(body).toContain("outline-offset: 2px");
    // A hardcoded hex would not follow the theme.
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("keeps the component-level rings that override the fallback", () => {
    // The shared input and button classes opt into their own accent ring,
    // which is what a reviewer sees on a focused button rather than the base
    // outline.
    expect(css).toContain("focus-visible:ring-accent/40");
    expect(css).toContain("focus-visible:ring-accent/70");
  });
});
