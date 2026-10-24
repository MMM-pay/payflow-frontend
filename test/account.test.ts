import { describe, expect, it } from "vitest";
import {
  sortVaultEventsNewestFirst,
  vaultEventAmount,
  vaultEventIsCredit,
  vaultEventLabel,
  vaultEventTone,
} from "@/lib/chain";
import {
  canEditChargeCap,
  parseChargeCapInput,
} from "@/lib/payflow";
import type { ApiVaultEvent } from "@/lib/api";

/**
 * Vault event helpers are pure functions: they turn backend vault events into
 * display values (signed amounts, text labels, colour tones, ordering) without
 * touching React or the DOM. Pinning them keeps the account page's balance
 * reconciliation accurate and colour-independent.
 */

function event(over: Partial<ApiVaultEvent> = {}): ApiVaultEvent {
  return {
    type: "deposit",
    amount: "10000000", // 1 XLM
    tx_hash: "abcd1234",
    ledger: 50000,
    ...over,
  };
}

describe("vaultEventIsCredit", () => {
  it("treats deposits as credits and withdrawals/debits as debits", () => {
    expect(vaultEventIsCredit(event({ type: "deposit" }))).toBe(true);
    expect(vaultEventIsCredit(event({ type: "withdraw" }))).toBe(false);
    expect(vaultEventIsCredit(event({ type: "debit" }))).toBe(false);
  });
});

describe("vaultEventLabel", () => {
  it("returns a text label for every event type, not colour only", () => {
    expect(vaultEventLabel(event({ type: "deposit" }))).toBe("Deposit");
    expect(vaultEventLabel(event({ type: "withdraw" }))).toBe("Withdrawal");
    expect(vaultEventLabel(event({ type: "debit" }))).toBe("Debit");
  });
});

describe("vaultEventAmount", () => {
  it("signs deposits positive and withdrawals/debits negative as decimal strings", () => {
    expect(vaultEventAmount(event({ type: "deposit", amount: "10000000" }))).toBe(
      "+1",
    );
    expect(vaultEventAmount(event({ type: "withdraw", amount: "5000000" }))).toBe(
      "-0.5",
    );
    expect(vaultEventAmount(event({ type: "debit", amount: "9900000" }))).toBe(
      "-0.99",
    );
  });

  it("keeps large amounts exact without floating point", () => {
    // 1 million XLM — beyond safe integer range once scaled to stroops.
    expect(
      vaultEventAmount(event({ type: "deposit", amount: "10000000000000" })),
    ).toBe("+1000000");
    expect(
      vaultEventAmount(event({ type: "debit", amount: "500000000000" })),
    ).toBe("-50000");
  });
});

describe("vaultEventTone", () => {
  it("colour-codes deposits as ok and withdrawals/debits as error", () => {
    expect(vaultEventTone(event({ type: "deposit" }))).toBe("ok");
    expect(vaultEventTone(event({ type: "withdraw" }))).toBe("error");
    expect(vaultEventTone(event({ type: "debit" }))).toBe("error");
  });
});

describe("sortVaultEventsNewestFirst", () => {
  it("sorts by ledger descending and does not mutate the input", () => {
    const events = [
      event({ ledger: 1, tx_hash: "aaa" }),
      event({ ledger: 3, tx_hash: "ccc" }),
      event({ ledger: 2, tx_hash: "bbb" }),
    ];
    const sorted = sortVaultEventsNewestFirst(events);
    expect(sorted.map((e) => e.ledger)).toEqual([3, 2, 1]);
    expect(sorted.map((e) => e.tx_hash)).toEqual(["ccc", "bbb", "aaa"]);
    // Original array is untouched.
    expect(events.map((e) => e.ledger)).toEqual([1, 3, 2]);
  });

  it("handles empty and single-element lists", () => {
    expect(sortVaultEventsNewestFirst([])).toEqual([]);
    expect(sortVaultEventsNewestFirst([event()])).toEqual([event()]);
  });
});

describe("parseChargeCapInput", () => {
  it("parses a whole XL amount into stroops as a bigint", () => {
    expect(parseChargeCapInput("1")).toBe(10000000n);
    expect(parseChargeCapInput("12.5")).toBe(125000000n);
  });

  it("keeps large amounts exact without floating point", () => {
    expect(parseChargeCapInput("1000000")).toBe(10000000000000n);
  });

  it("rejects empty, negative, non-numeric and too-precise inputs", () => {
    expect(parseChargeCapInput("")).toBe(null);
    expect(parseChargeCapInput("   ")).toBe(null);
    expect(parseChargeCapInput("-1")).toBe(null);
    expect(parseChargeCapInput("abc")).toBe(null);
    expect(parseChargeCapInput("0.12345678")).toBe(null);
  });
});

describe("canEditChargeCap", () => {
  it("allows editing when the new cap is at least the charges made", () => {
    expect(canEditChargeCap(3, null)).toBe(true);
  });
});
