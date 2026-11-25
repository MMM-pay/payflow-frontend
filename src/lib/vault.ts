import type { ApiMandate } from "./api";
import { nextChargeAmount } from "./discount";
import { mandateStatus } from "./mandate-status";

/**
 * How a subscriber's vault balance splits between money already promised to
 * active subscriptions and the remainder that is still freely withdrawable.
 *
 * "Committed" is the sum of the *next* charge of every active mandate in the
 * vault's token. Future charges beyond that are not counted: a mandate can be
 * paused or cancelled between now and then, so claiming the whole remaining
 * schedule would overstate what is owed today. Discounted mandates commit the
 * discounted amount, exactly what the next debit will be.
 *
 * The vault itself does not lock funds — the subscriber can withdraw at any
 * time — so `free` is what remains after honouring those next charges. When
 * the balance is short of the committed amount, `free` is zero and `shortfall`
 * says by how much the vault is short rather than showing a negative balance.
 */
export interface VaultCommitment {
  /** Smallest-unit amount promised to the next charge of each active mandate. */
  committed: bigint;
  /** Balance left after those charges, never negative. */
  free: bigint;
  /** How much the balance falls short of `committed`, or zero. */
  shortfall: bigint;
  /** Active mandates in the vault's token counted toward `committed`. */
  activeCount: number;
}

export function vaultCommitment(
  balance: bigint | null,
  mandates: readonly ApiMandate[] | null,
  vaultToken?: string,
): VaultCommitment | null {
  if (balance === null || mandates === null) return null;

  let committed = 0n;
  let activeCount = 0;

  for (const mandate of mandates) {
    if (mandateStatus(mandate.status) !== "Active") continue;
    // A vault only pays mandates denominated in its own token. Mandates from
    // other tokens are read through their own vault/token elsewhere.
    if (vaultToken && mandate.token && mandate.token !== vaultToken) continue;

    let amount: bigint;
    try {
      amount = nextChargeAmount(mandate) ?? BigInt(mandate.amount);
    } catch {
      // A malformed amount from an untrusted source must not blank the page;
      // it simply cannot be counted as committed.
      continue;
    }
    if (amount <= 0n) continue;

    committed += amount;
    activeCount += 1;
  }

  return {
    committed,
    free: balance > committed ? balance - committed : 0n,
    shortfall: committed > balance ? committed - balance : 0n,
    activeCount,
  };
}
