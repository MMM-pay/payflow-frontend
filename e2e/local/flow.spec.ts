import { expect, test } from "@playwright/test";
import {
  XLM,
  approveWalletSigning,
  connectTestWallet,
  getMandate,
  getNextPlanId,
  getPlan,
  getVaultBalance,
  installTestWallet,
  loadContracts,
  newestSubscriberMandate,
} from "./contracts";

/**
 * End-to-end against a local Stellar network (payflow-frontend#117).
 *
 * Runs the static export with NEXT_PUBLIC_API_URL empty — the contract-only
 * mode the public demo uses — against the real plan-registry, vault and
 * subscription contracts, signing every write with a generated keypair handed
 * to the app through the Stellar Wallets Kit.
 *
 * Each step asserts the transaction notice the UI shows only after
 * `writeContract` has polled the transaction to SUCCESS, and then reads the
 * same state back from the contract. A write that fails on-chain fails the
 * step twice over.
 *
 * The suite is serial because every test acts on state the previous one wrote:
 * the plan the merchant publishes, then the mandate the subscriber opens
 * against it, then the cancellation.
 */

const contracts = loadContracts();
const merchant = contracts.accounts.admin;
const subscriber = contracts.accounts.subscriber;

test.describe.configure({ mode: "serial" });

let planId: bigint;
let mandateId: bigint;

test.beforeEach(async ({ page }) => {
  // Any request the app makes outside the local network is a bug in the test.
  // Horizon and the RPC are on the local network; anything else is blocked so
  // a stray call cannot make a flaky run pass.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    const local = ["127.0.0.1", "localhost"];
    if (local.includes(url.hostname)) return route.continue();
    return route.abort();
  });
});

test("merchant publishes a plan", async ({ page }) => {
  await page.goto("/merchant/", { waitUntil: "networkidle" });
  await installTestWallet(page, merchant.secret, contracts.networkPassphrase);
  await connectTestWallet(page, merchant.publicKey);

  // The published form's own ids: the page also repeats the token symbol in
  // other labels, so the id is the unambiguous handle.
  await page.locator("#price").fill("1");
  await page.locator("#plan-name").fill("E2E Coffee");
  await page.getByRole("button", { name: "Publish plan", exact: true }).click();
  await approveWalletSigning(page);

  await expect(page.getByText("Done. Transaction")).toBeVisible({ timeout: 60_000 });

  planId = (await getNextPlanId(contracts)) - 1n;
  // `deploy-contracts.mjs` seeds one plan so /plans/[id]/ has a page to
  // export; the plan this test published is the newest id after it.
  expect(planId).toBeGreaterThan(1n);

  const plan = await getPlan(contracts, planId);
  expect(plan.name).toBe("E2E Coffee");
  // Amounts stay in the smallest unit and never pass through a float.
  expect(plan.amount).toBe(1n * XLM);
  expect(plan.merchant).toBe(merchant.publicKey);
  expect(plan.active).toBe(true);

  // The plan is listed from contract state, with no indexer configured.
  await page.goto("/subscribe/", { waitUntil: "networkidle" });
  await expect(page.getByText("E2E Coffee")).toBeVisible({ timeout: 30_000 });
});

test("subscriber deposits into the vault", async ({ page }) => {
  await page.goto("/account/", { waitUntil: "networkidle" });
  await installTestWallet(page, subscriber.secret, contracts.networkPassphrase);
  await connectTestWallet(page, subscriber.publicKey);

  // "Fund another account" repeats the same visible label, so target the
  // deposit field by id.
  await page.locator("#amount").fill("5");
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await approveWalletSigning(page);

  await expect(page.getByText("Done. Transaction")).toBeVisible({ timeout: 60_000 });
  expect(await getVaultBalance(contracts, subscriber.publicKey)).toBe(5n * XLM);
});

test("subscriber opens a mandate", async ({ page }) => {
  await page.goto("/subscribe/", { waitUntil: "networkidle" });
  await installTestWallet(page, subscriber.secret, contracts.networkPassphrase);
  await connectTestWallet(page, subscriber.publicKey);

  const card = page.locator("section.panel", { hasText: "E2E Coffee" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Subscribe", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Subscribe to E2E Coffee?")).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm and sign" }).click();
  await approveWalletSigning(page);

  await expect(page.getByText("Subscribed. Transaction")).toBeVisible({ timeout: 60_000 });

  mandateId = 1n;
  const mandate = await getMandate(contracts, mandateId);
  expect(mandate.subscriber).toBe(subscriber.publicKey);
  expect(mandate.merchant).toBe(merchant.publicKey);
  expect(mandate.amount).toBe(1n * XLM);
  // A no-data enum variant decodes as ["Active"], never "Active".
  expect(String((mandate.status as unknown[])[0])).toBe("Active");
});

test("subscriber cancels the mandate", async ({ page }) => {
  await page.goto("/account/", { waitUntil: "networkidle" });
  await installTestWallet(page, subscriber.secret, contracts.networkPassphrase);
  await connectTestWallet(page, subscriber.publicKey);

  const id = mandateId ?? (await newestSubscriberMandate(contracts, subscriber.publicKey));
  mandateId = id;
  const cancel = page.getByRole("button", {
    name: `Cancel subscription #${mandateId}`,
  });
  await expect(cancel).toBeVisible({ timeout: 60_000 });
  await cancel.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm cancellation" })
    .click();
  await approveWalletSigning(page);

  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  const mandate = await getMandate(contracts, mandateId);
  expect(String((mandate.status as unknown[])[0])).toBe("Cancelled");
});
