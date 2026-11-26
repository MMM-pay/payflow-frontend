import { expect, test, type Page } from "@playwright/test";
import { Keypair } from "@stellar/stellar-sdk";
import {
  VISUAL_NETWORK_PASSPHRASE,
  installMockRpc,
  type MockRpc,
  type MockRpcOptions,
} from "./mock-rpc";

const SUBSCRIBER_KEYPAIR = Keypair.fromRawEd25519Seed(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
);
const SUBSCRIBER = SUBSCRIBER_KEYPAIR.publicKey();

interface SetupOptions extends MockRpcOptions {
  wallet?: boolean;
  passphrase?: string;
}

async function setup(page: Page, options: SetupOptions = {}): Promise<MockRpc> {
  const rpc = await installMockRpc(page, options.subscribe === undefined ? {} : { subscribe: options.subscribe });
  const rpc = await installMockRpc(
    page,
    options.subscribe !== undefined ? { subscribe: options.subscribe } : {},
  );
  await page.addInitScript(
    ({ secret, passphrase }) => {
      window.localStorage.clear();
      if (secret) {
        (window as unknown as Record<string, unknown>).__PAYFLOW_E2E_WALLET__ = {
          secret,
          networkPassphrase: passphrase,
        };
      }
    },
    {
      secret: options.wallet === false ? null : SUBSCRIBER_KEYPAIR.secret(),
      passphrase: options.passphrase ?? VISUAL_NETWORK_PASSPHRASE,
    },
  );
  return rpc;
}

async function openSubscribePage(page: Page): Promise<void> {
  await page.goto("/subscribe/?plan=1", { waitUntil: "networkidle" });
}

async function connectWallet(page: Page): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: "Connect wallet" }).click();
  await page.getByText("E2E test wallet", { exact: true }).click();
  await expect(page.getByTitle(new RegExp(`^${SUBSCRIBER}`))).toBeVisible();
}

async function planCard(page: Page) {
  const card = page.locator("section.panel", { hasText: "Coffee subscription" });
  await expect(card).toBeVisible();
  return card;
}

async function openConfirmation(page: Page, cap = "0") {
  const card = await planCard(page);
  await page.locator("#limit-1").fill(cap);
  await card.getByRole("button", { name: "Subscribe", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function approveSigningIfShown(page: Page) {
  const dialog = page.getByRole("dialog");
  const continueBtn = dialog.getByRole("button", { name: "Continue to wallet" });
  await continueBtn
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => continueBtn.click())
    .catch(() => {});
}

function hasWrite(rpc: MockRpc): boolean {
  return rpc.calls.some((call) => call.kind === "sendTransaction");
}

test("subscribes end to end with a mocked wallet and chain", async ({ page }) => {
  const rpc = await setup(page);
  await openSubscribePage(page);
  await connectWallet(page);

  const dialog = await openConfirmation(page, "2");
  await expect(dialog.getByText("Subscribe to Coffee subscription?")).toBeVisible();
  await expect(dialog.getByText("2 charges, then the mandate completes.")).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm and sign" }).click();
  await approveSigningIfShown(page);

  await expect(page.getByText("Subscribed. Transaction")).toBeVisible();
  expect(rpc.lastHash).toMatch(/^[0-9a-f]{64}$/);
  await expect(page.locator(`a[href$="/tx/${rpc.lastHash}"]`)).toBeVisible();

  const subscribeCalls = rpc.calls.filter(
    (call) => call.kind === "simulate" && call.contractMethod === "subscribe",
  );
  expect(subscribeCalls).toHaveLength(1);
  const subscribe = subscribeCalls[0];
  if (subscribe?.kind !== "simulate") throw new Error("subscribe was not simulated");
  expect(subscribe.args[0]).toBe(SUBSCRIBER);
  expect(subscribe.args[1]).toBe(1n);
  expect(subscribe.args[2]).toBe(2);
  expect(rpc.calls.filter((call) => call.kind === "sendTransaction")).toHaveLength(1);
  expect(rpc.calls.filter((call) => call.kind === "getTransaction")).toHaveLength(1);
});

test("shows the contract's reason and signs nothing when simulation is rejected", async ({ page }) => {
  const rpc = await setup(page, { subscribe: "contract-error" });
  await openSubscribePage(page);
  await connectWallet(page);

  const dialog = await openConfirmation(page);
  await dialog.getByRole("button", { name: "Confirm and sign" }).click();

  await expect(page.getByText("That plan does not exist.")).toBeVisible();
  await expect(page.getByText("Subscribed. Transaction")).toHaveCount(0);
  expect(hasWrite(rpc)).toBe(false);
});

test("reports an on-chain failure after submitting the signed transaction", async ({ page }) => {
  const rpc = await setup(page, { subscribe: "failed" });
  await openSubscribePage(page);
  await connectWallet(page);

  const dialog = await openConfirmation(page);
  await dialog.getByRole("button", { name: "Confirm and sign" }).click();
  await approveSigningIfShown(page);

  await expect(page.getByText("subscribe failed on-chain (FAILED)")).toBeVisible();
  await expect(page.getByText("Subscribed. Transaction")).toHaveCount(0);
  expect(rpc.calls.filter((call) => call.kind === "sendTransaction")).toHaveLength(1);
  expect(rpc.calls.filter((call) => call.kind === "getTransaction")).toEqual([
    { kind: "getTransaction", hash: rpc.lastHash, status: "FAILED" },
  ]);
});

test("keeps the subscribe button unavailable without a wallet", async ({ page }) => {
  const rpc = await setup(page, { wallet: false });
  await openSubscribePage(page);

  const card = await planCard(page);
  await expect(card.getByRole("button", { name: "Connect wallet" })).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(hasWrite(rpc)).toBe(false);
});

test("blocks subscribing when the injected wallet reports the wrong network", async ({ page }) => {
  const rpc = await setup(page, { passphrase: "Wrong Network ; September 2015" });
  await openSubscribePage(page);
  await connectWallet(page);

  const card = await planCard(page);
  await expect(card.getByRole("button", { name: "Wrong network" })).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(hasWrite(rpc)).toBe(false);
});

test("rejects a non-integer charge limit before opening the dialog", async ({ page }) => {
  const rpc = await setup(page);
  await openSubscribePage(page);
  await connectWallet(page);

  const card = await planCard(page);
  await page.locator("#limit-1").fill("1.5");
  await card.getByRole("button", { name: "Subscribe", exact: true }).click();

  await expect(
    page.getByText("Charge limit must be a whole number, or 0 for open-ended."),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(hasWrite(rpc)).toBe(false);
});

test("cancelling the confirmation asks for no signature and submits nothing", async ({ page }) => {
  const rpc = await setup(page);
  await openSubscribePage(page);
  await connectWallet(page);

  const dialog = await openConfirmation(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Subscribed. Transaction")).toHaveCount(0);
  expect(hasWrite(rpc)).toBe(false);
});
