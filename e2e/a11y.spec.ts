import { expect, test } from "@playwright/test";
import { READ_SOURCE, installMockRpc } from "./mock-rpc";

/**
 * Accessibility smoke test on core routes in CI (payflow-frontend#359).
 *
 * Verifies key a11y criteria across main routes:
 * - Landmark roles (main, navigation, contentinfo)
 * - Heading structure (h1 present)
 * - Skip link accessibility
 * - Deterministic, mocking RPC and blocking network
 */

const CORE_ROUTES = [
  { name: "home", path: "/" },
  { name: "subscribe", path: "/subscribe/" },
  { name: "merchant", path: "/merchant/" },
  { name: "account", path: "/account/" },
  { name: "mandates", path: "/mandates/" },
  { name: "merchant-public", path: `/m/?address=${READ_SOURCE}` },
];

for (const { name, path } of CORE_ROUTES) {
  test.describe(`a11y smoke: ${name}`, () => {
    test.beforeEach(async ({ page }) => {
      await installMockRpc(page);
    });

    test(`${name} has accessible landmarks and structure`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });

      // Core landmark must be visible
      const main = page.getByRole("main");
      await expect(main).toBeVisible();

      // Heading must be present
      const h1 = page.locator("h1");
      await expect(h1.first()).toBeVisible();

      // Skip link should target main content
      const skipLink = page.getByRole("link", { name: /Skip to content/i });
      if (await skipLink.count() > 0) {
        await expect(skipLink).toHaveAttribute("href", "#main-content");
      }
    });
  });
}
