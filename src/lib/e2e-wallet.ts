"use client";

import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit";

/**
 * A Stellar Wallets Kit module backed by a keypair supplied by the test
 * before the wallet modal opens (payflow-frontend#117).
 *
 * The end-to-end job runs the real app against a local Stellar network. The
 * browser there has no wallet extension to install, so the test sets an
 * ephemeral secret on the loaded page. This module — compiled in only when
 * `NEXT_PUBLIC_E2E_WALLET=1` — signs with it through the same kit interface
 * the production wallets implement. That keeps
 * the test on the production code path: `useWallet().signXdr`, the kit's
 * `signTransaction`, and the app's own RPC submission are all exercised.
 *
 * The module reports itself unavailable when no secret was injected, and it is
 * never added to the module list unless the build opted in, so a normal build
 * can neither show it nor sign with anything.
 */

/** Key the test writes onto `window` before opening the wallet modal. */
export const E2E_WALLET_CONFIG_KEY = "__PAYFLOW_E2E_WALLET__";

/** Id the tests select in the kit's wallet modal. */
export const E2E_WALLET_PRODUCT_ID = "e2e-local";

/** Name the kit's modal shows for this module. */
export const E2E_WALLET_PRODUCT_NAME = "E2E test wallet";

export interface E2EWalletConfig {
  /** Ed25519 secret key (`S...`) for the account the test acts as. */
  secret: string;
  /** Passphrase of the local network, so the stub can sign the right bytes. */
  networkPassphrase: string;
}

function readConfig(): E2EWalletConfig | null {
  if (typeof window === "undefined") return null;
  const raw = (window as unknown as Record<string, unknown>)[E2E_WALLET_CONFIG_KEY];
  if (!raw || typeof raw !== "object") return null;
  const { secret, networkPassphrase } = raw as Partial<E2EWalletConfig>;
  if (typeof secret !== "string" || !secret.startsWith("S")) return null;
  if (typeof networkPassphrase !== "string" || !networkPassphrase) return null;
  return { secret, networkPassphrase };
}

function requireConfig(): E2EWalletConfig {
  const config = readConfig();
  if (!config) {
    throw new Error(
      `E2E wallet is not configured: set window.${E2E_WALLET_CONFIG_KEY} before the app loads.`,
    );
  }
  return config;
}

export function createE2EWalletModule(): ModuleInterface {
  // The SDK is imported lazily so a build without the module enabled can tree
  // shake this file away and, with it, the keypair handling.
  async function signer() {
    const config = requireConfig();
    const { Keypair } = await import("@stellar/stellar-sdk");
    const keypair = Keypair.fromSecret(config.secret);
    return { config, keypair };
  }

  return {
    moduleType: "HOT_WALLET" as ModuleInterface["moduleType"],
    productId: E2E_WALLET_PRODUCT_ID,
    productName: E2E_WALLET_PRODUCT_NAME,
    productUrl: "https://github.com/MMM-pay/payflow-frontend/issues/117",
    productIcon: "",
    isAvailable: async () => readConfig() !== null,

    async getAddress() {
      const { keypair } = await signer();
      return { address: keypair.publicKey() };
    },

    async signTransaction(xdr, opts) {
      const { config, keypair } = await signer();
      const { TransactionBuilder, authorizeEntry } = await import("@stellar/stellar-sdk");
      const passphrase = opts?.networkPassphrase ?? config.networkPassphrase;
      const transaction = TransactionBuilder.fromXDR(xdr, passphrase);

      // A real wallet signs the envelope and every address-credential auth
      // entry the simulation attached (the token transfer behind a deposit or
      // subscribe, for instance). Signing only the envelope would be rejected
      // on-chain, so do both and keep the test on the production path.
      type AuthEntry = {
        credentials: {
          type: string;
          address?: { signatureExpirationLedger: number };
        };
      };
      const operations = (
        transaction as unknown as { operations: Array<{ type: string; auth?: AuthEntry[] }> }
      ).operations;
      for (const operation of operations) {
        if (operation.type !== "invokeHostFunction" || !operation.auth?.length) continue;
        operation.auth = await Promise.all(
          operation.auth.map((entry) => {
            if (entry.credentials.type !== "sorobanCredentialsAddress") return entry;
            const expiration = entry.credentials.address?.signatureExpirationLedger ?? 0;
            return authorizeEntry(
              entry as never,
              keypair,
              expiration,
              passphrase,
            ) as Promise<AuthEntry>;
          }),
        );
      }

      // A fee-bump envelope and a plain transaction share `sign`, but TypeScript
      // cannot call it on the union.
      const signable = transaction as unknown as { sign(signer: unknown): void };
      signable.sign(keypair);
      return {
        signedTxXdr: transaction.toXDR(),
        signerAddress: keypair.publicKey(),
      };
    },

    async signAuthEntry() {
      throw new Error("The E2E wallet does not sign auth entries.");
    },

    async signMessage() {
      throw new Error("The E2E wallet does not sign messages.");
    },

    async getNetwork() {
      const config = requireConfig();
      return {
        network: "STANDALONE",
        networkPassphrase: config.networkPassphrase,
      };
    },

    async disconnect() {
      // Nothing is persisted in the stub; the app clears its own session.
    },
  };
}
