import { expect, test } from "@playwright/test";
import { READ_SOURCE, installMockRpc } from "./mock-rpc";

/**
 * Reflow checks (payflow-frontend#377).
 *
 * WCAG 2.1 AA 1.4.10 requires content to reflow without two-dimensional
 * scrolling at a width equivalent to 320 CSS px — 400% zoom on a 1280 px
 * window — and the issue asks specifically for 200% zoom, which is 640 CSS px
 * on the same window. At both widths every page must stay one-dimensional:
 * the document itself never scrolls sideways. Wide data tables are allowed to
 * scroll *inside* their own labelled, focusable region; that is what the
 * `[role="region"]` scroll containers in this app are for.
 *
 * The viewport is overridden per describe block rather than in the projects in
 * playwright.config.ts, so the existing visual baselines keep their widths.
 */

const PAGES = [
  { name: "home", path: "/" },
  { name: "account", path: "/account/" },
  { name: "mandates", path: "/mandates/" },
  { name: "merchant-portal", path: "/merchant/" },
  { name: "merchant-public", path: `/m/?address=${READ_SOURCE}` },
  { name: "plan", path: "/plans/1/" },
  { name: "receipt", path: "/receipt/" },
  { name: "subscribe", path: "/subscribe/" },
];

const VIEWPORTS = [
  // 200% zoom on a 1280x1024 display.
  { name: "200% zoom", viewport: { width: 640, height: 512 } },
  // The WCAG 1.4.10 floor: 320 CSS px, the same page at 400% zoom.
  { name: "320px wide", viewport: { width: 320, height: 256 } },
];

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`reflow at ${name}`, () => {
    test.use({ viewport });

    for (const { name: pageName, path } of PAGES) {
      test(`${pageName} does not scroll horizontally`, async ({ page }) => {
        await installMockRpc(page);
        await page.goto(path, { waitUntil: "networkidle" });

        // A blank or error page would also "not overflow"; require the shell.
        await expect(page.getByRole("main")).toBeVisible();

        const overflow = await page.evaluate(() => {
          const root = document.documentElement;
          const over = root.scrollWidth - root.clientWidth;
          if (over <= 1) return { over, culprit: null as string | null };

          // Name the widest offending element so a failure is actionable.
          let culprit: string | null = null;
          let worst = root.clientWidth;
          for (const node of Array.from(document.querySelectorAll("body *"))) {
            const rect = node.getBoundingClientRect();
            if (rect.right <= worst) continue;
            worst = rect.right;
            const tag = node.tagName.toLowerCase();
            const id = node.id ? `#${node.id}` : "";
            const cls = typeof node.className === "string" && node.className
              ? `.${node.className.trim().split(/\s+/).slice(0, 3).join(".")}`
              : "";
            culprit = `${tag}${id}${cls} (right edge ${Math.round(rect.right)}px)`;
          }
          return { over, culprit };
        });

        expect(
          overflow.over,
          `page is ${overflow.over}px wider than the ${viewport.width}px viewport` +
            (overflow.culprit ? `; widest element: ${overflow.culprit}` : ""),
        ).toBeLessThanOrEqual(1);
      });
    }
  });
}
