import { defineConfig } from "@playwright/test";

/**
 * End-to-end suite against a local Stellar network (payflow-frontend#117).
 *
 * Unlike the visual suite, this one talks to a real local network: the
 * contracts were deployed by `e2e/local/deploy-contracts.mjs` and the static
 * export in out/ was built against their ids by `e2e/local/export-env.mjs`.
 * Nothing is mocked, so the tests are serial and there is one worker.
 */
export default defineConfig({
  testDir: "./e2e/local",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Four writes, each waiting for its transaction to be included, plus the
  // contract reads that verify them.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    serviceWorkers: "block",
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: "node e2e/serve.mjs",
    url: "http://127.0.0.1:4174/",
    env: { PORT: "4174" },
    reuseExistingServer: !process.env.CI,
  },
});
