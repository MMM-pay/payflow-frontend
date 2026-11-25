// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  E2E_WALLET_CONFIG_KEY,
  E2E_WALLET_PRODUCT_ID,
  createE2EWalletModule,
} from "@/lib/e2e-wallet";

/**
 * The Playwright suite's wallet stub (payflow-frontend#117).
 *
 * The browser run is the real proof, but these guard the two things a silent
 * regression would break: the module stays unavailable unless the test
 * injected a key, and signing produces a transaction the app can submit.
 */

const PASSPHRASE = "Standalone Network ; February 2017";

function injectConfig(secret?: string) {
  const target = window as unknown as Record<string, unknown>;
  if (secret === undefined) {
    delete target[E2E_WALLET_CONFIG_KEY];
    return;
  }
  target[E2E_WALLET_CONFIG_KEY] = { secret, networkPassphrase: PASSPHRASE };
}

describe("createE2EWalletModule", () => {
  beforeEach(() => injectConfig(undefined));
  afterEach(() => injectConfig(undefined));

  it("is unavailable when no key was injected", async () => {
    const wallet = createE2EWalletModule();
    expect(wallet.productId).toBe(E2E_WALLET_PRODUCT_ID);
    expect(await wallet.isAvailable()).toBe(false);
    await expect(wallet.getAddress()).rejects.toThrow(/not configured/);
    await expect(wallet.getNetwork()).rejects.toThrow(/not configured/);
  });

  it("reports the injected account and its network", async () => {
    const keypair = Keypair.random();
    injectConfig(keypair.secret());
    const wallet = createE2EWalletModule();

    expect(await wallet.isAvailable()).toBe(true);
    expect(await wallet.getAddress()).toEqual({ address: keypair.publicKey() });
    expect(await wallet.getNetwork()).toEqual({
      network: "STANDALONE",
      networkPassphrase: PASSPHRASE,
    });
  });

  it("signs a transaction the app could submit", async () => {
    const keypair = Keypair.random();
    injectConfig(keypair.secret());
    const wallet = createE2EWalletModule();

    const source = new Account(keypair.publicKey(), "1");
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: keypair.publicKey(),
          asset: Asset.native(),
          amount: "1",
        }),
      )
      .setTimeout(60)
      .build();

    const { signedTxXdr, signerAddress } = await wallet.signTransaction(tx.toXDR(), {
      networkPassphrase: PASSPHRASE,
    });

    expect(signerAddress).toBe(keypair.publicKey());
    const signed = TransactionBuilder.fromXDR(signedTxXdr, PASSPHRASE);
    expect(signed.signatures).toHaveLength(1);
    // Signing must not change the transaction the hash commits to.
    expect(Buffer.from(signed.hash()).toString("hex")).toBe(
      Buffer.from(tx.hash()).toString("hex"),
    );
  });
});
