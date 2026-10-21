import type { ApiMandate } from "./api";
import { discountBps, discountedAmount, remainingDiscountCharges } from "./discount";

function normalizeStatus(raw: unknown): string {
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return typeof raw === "string" ? raw : String(raw ?? "");
}

export interface VaultRunway {
  /** How many upcoming charges the current vault balance can fully pay for. */
  chargesCovered: number;
  /**
   * Unix timestamp (seconds) of the first charge that cannot be covered,
   * or null if the balance covers all scheduled charges indefinitely (or through all mandate caps).
   */
  runsOutDate: number | null;
  /** True when active mandates exist but fewer than 2 upcoming charges are covered. */
  isLow: boolean;
  /** Number of active mandates drawing against the balance. */
  activeMandatesCount: number;
  /** Whether there is at least one active mandate. */
  hasActiveMandates: boolean;
}

interface QueuedCharge {
  due: number;
  amount: bigint;
  mandateId: number;
}

/**
 * Computes how many upcoming charges the subscriber's vault balance covers
 * and when funding will run out, across all active mandates.
 *
 * Handles both open-ended and capped mandates, discounts, and custom billing periods.
 * All amount arithmetic remains bigint in stroops.
 */
export function computeVaultRunway(
  balance: bigint | null,
  mandates: ApiMandate[] | null,
  vaultToken?: string,
): VaultRunway | null {
  if (balance === null || mandates === null) return null;

  // Only active mandates consume the vault balance
  const active = mandates.filter((m) => {
    if (normalizeStatus(m.status) !== "Active") return false;
    if (vaultToken && m.token && m.token !== vaultToken) return false;
    return true;
  });

  if (active.length === 0) {
    return {
      chargesCovered: 0,
      runsOutDate: null,
      isLow: false,
      activeMandatesCount: 0,
      hasActiveMandates: false,
    };
  }

  // Generate future charges across all active mandates
  const queued: QueuedCharge[] = [];
  let allCapped = true;

  for (const m of active) {
    const rawAmount = BigInt(m.amount);
    const period = m.period > 0 ? m.period : 2_592_000;
    const nextCharge = Number(m.next_charge);
    if (!Number.isFinite(nextCharge) || nextCharge <= 0) continue;

    const isCapped = m.max_charges > 0;
    if (!isCapped) {
      allCapped = false;
    }

    const remainingCaps = isCapped ? Math.max(0, m.max_charges - m.charges_made) : Infinity;
    if (remainingCaps === 0) continue;

    const discountRem = remainingDiscountCharges(m);
    const discBps = discountBps(m);

    // Limit generation to what the balance could possibly cover plus one failing charge
    let generatedSum = 0n;
    const maxToGenerate = Math.min(remainingCaps, 200);

    for (let k = 0; k < maxToGenerate; k++) {
      const due = nextCharge + k * period;
      const isDiscounted = discountRem !== null && k < discountRem;
      const chargeAmt = isDiscounted ? discountedAmount(rawAmount, discBps) : rawAmount;

      queued.push({
        due,
        amount: chargeAmt,
        mandateId: m.id,
      });

      generatedSum += chargeAmt;
      // Once generated charges exceed the balance, we have at least one charge that cannot be covered
      if (generatedSum > balance && k >= 2) {
        break;
      }
    }
  }

  // Sort chronologically
  queued.sort((a, b) => a.due - b.due || a.mandateId - b.mandateId);

  let remainingBal = balance;
  let chargesCovered = 0;
  let runsOutDate: number | null = null;

  for (const charge of queued) {
    if (remainingBal >= charge.amount) {
      remainingBal -= charge.amount;
      chargesCovered += 1;
    } else {
      runsOutDate = charge.due;
      break;
    }
  }

  // If all active mandates are capped and balance covered all possible charges
  if (runsOutDate === null && !allCapped && queued.length > 0 && remainingBal < queued[queued.length - 1]!.amount) {
    // If open-ended and we stopped generating, the next charge after the last queued is the exhaustion date
    runsOutDate = queued[queued.length - 1]!.due;
  }

  const isLow = chargesCovered < 2;

  return {
    chargesCovered,
    runsOutDate,
    isLow,
    activeMandatesCount: active.length,
    hasActiveMandates: true,
  };
}

/**
 * Format a human-readable summary of the runway.
 */
export function formatRunway(runway: VaultRunway, formatDateFn: (epoch: number) => string): {
  headline: string;
  detail: string;
} {
  if (!runway.hasActiveMandates) {
    return {
      headline: "No active charges",
      detail: "No active subscriptions are currently drawing from your vault.",
    };
  }

  if (runway.chargesCovered === 0) {
    const dueStr = runway.runsOutDate ? `due ${formatDateFn(runway.runsOutDate)}` : "immediately";
    return {
      headline: "0 charges covered",
      detail: `Your balance cannot cover the next charge (${dueStr}). Deposit funds to keep subscriptions active.`,
    };
  }

  const chargeWord = runway.chargesCovered === 1 ? "charge" : "charges";
  if (runway.runsOutDate === null) {
    return {
      headline: `Covers ${runway.chargesCovered} ${chargeWord}`,
      detail: "All scheduled charges are fully funded.",
    };
  }

  return {
    headline: `Covers ${runway.chargesCovered} ${chargeWord}`,
    detail: `Runs out on ${formatDateFn(runway.runsOutDate)} when the next charge falls due.`,
  };
}
