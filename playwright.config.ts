import { defineConfig } from "@playwright/test";

/**
 * Visual regression tests (payflow-frontend#55).
 *
 * Screenshots are compared against baselines committed under
 * e2e/__screenshots__/, one folder per project (desktop and 375px mobile).
 * The app under test is the static export in out/, built by
 * `npm run build:visual` so the version and commit stamped into the footer
 * are fixed. Soroban RPC is mocked (see e2e/mock-rpc.ts) and every other
 * external request is blocked, so pages render deterministic contract-only
 * states with no wallet, no backend and no network. See
 * docs/visual-regression.md for the update procedure.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  // Committed baselines live next to the tests, one folder per project.
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      // Tuned to absorb antialiasing and font-hinting noise while still
      // catching a real layout break: a reflow at either width moves far
      // more than 2% of the pixels. 0.2 is the per-pixel colour tolerance.
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
      animations: "disabled",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    // The app registers a service worker; a cached app shell would make
    // later tests render from cache instead of the files under test.
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 720 } },
    },
    {
      // The layout width the issues watch for, about 375px. Chromium paints
      // the same at this width as on a phone, and both projects use the same
      // font files, so baselines stay comparable.
      name: "mobile",
      use: { viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: {
    command: "node e2e/serve.mjs",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: !process.env.CI,
  },
});
