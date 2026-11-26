import { expect, test } from "@playwright/test";
import { READ_SOURCE, installMockRpc } from "./mock-rpc";

/**
 * Visual regression snapshots (payflow-frontend#55).
 *
 * Every statically exported page, rendered from contract-only state with the
 * RPC mocked, screenshotted at desktop (1280x720) and mobile (375x812)
 * width by the two projects in playwright.config.ts. Pages that would need a
 * connected wallet render their "connect your wallet" state, which is itself
 * worth pinning. Baselines live in e2e/__screenshots__/; see
 * docs/visual-regression.md for how to update them.
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

const THEME_PAGES = [
  { name: "subscribe", path: "/subscribe/" },
  { name: "merchant", path: "/merchant/" },
  { name: "account", path: "/account/" },
];

for (const { name, path } of PAGES) {
  test.describe(name, () => {
    test.beforeEach(async ({ page }) => {
      await installMockRpc(page);
    });

    test(`${name} matches its baseline`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      // Guard against snapshotting a blank or error page: every route renders
      // the layout's main landmark even with no wallet and no backend.
      await expect(page.getByRole("main")).toBeVisible();
      // toHaveScreenshot retries until two consecutive frames are identical,
      // so hydration and the mocked reads settle before the comparison.
      // Viewport-sized (not fullPage) screenshots keep dimensions stable across
      // environments where font metrics shift document height.
      await expect(page).toHaveScreenshot(`${name}.png`);
    });
  });
}

for (const { name, path } of THEME_PAGES) {
  test.describe(`${name} themes`, () => {
    test.beforeEach(async ({ page }) => {
      await installMockRpc(page);
    });

    for (const theme of ["light", "dark"] as const) {
      test(`${name} matches ${theme} baseline`, async ({ page }) => {
        await page.addInitScript((t) => {
          window.localStorage.setItem("payflow-theme", t);
          document.documentElement.dataset.theme = t;
        }, theme);
        await page.goto(path, { waitUntil: "networkidle" });
        await expect(page.getByRole("main")).toBeVisible();
        await expect(page).toHaveScreenshot(`${name}-${theme}.png`);
      });
    }
  });
}
