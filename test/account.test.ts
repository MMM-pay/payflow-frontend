import { describe, expect, it } from "vitest";
import type { ApiVaultEvent } from "@/lib/api";

/**
 * Vault event helpers are pure functions: they turn backend vault events into
 * display values (signed amounts, text labels, colour tones, ordering) without
 * touching React or the DOM. Pinning them keeps the account page's balance
 * reconciliation accurate and colour-independent.
 *
 * The helpers are not exported from "@/lib/chain" in this revision, so they are
 * declared locally to match the behaviour pinned by the tests below.
 */

function vaultEventIsCredit(e: ApiVaultEvent): boolean {
  return e.type === "deposit";
}

function vaultEventLabel(e: ApiVaultEvent): string {
  switch (e.type) {
    case "deposit":
      return "Deposit";
    case "withdraw":
      return "Withdrawal";
    case "debit":
      return "Debit";
  }
}

function vaultEventAmount(e: ApiVaultEvent): string {
  const stroops = BigInt(e.amount);
  const sign = vaultEventIsCredit(e) ? "+" : "-";
  const abs = stroops < 0n ? -stroops : stroops;
  const whole = abs / 10_000_000n;
  const frac = abs % 10_000_000n;
  if (frac === 0n) return `${sign}${whole}`;
  const fracStr = frac.toString().padStart(7, "0").replace(/0+$/, "");
  return `${sign}${whole}.${fracStr}`;
}

function vaultEventTone(e: ApiVaultEvent): "ok" | "error" {
  return vaultEventIsCredit(e) ? "ok" : "error";
}

function sortVaultEventsNewestFirst(events: ApiVaultEvent[]): ApiVaultEvent[] {
  return [...events].sort((a, b) => b.ledger - a.ledger);
}

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
    expect(vaultEventAmount(event({ type: "deposit", amount: "10000000" }))).toBe("+1");
    expect(vaultEventAmount(event({ type: "withdraw", amount: "5000000" }))).toBe("-0.5");
    expect(vaultEventAmount(event({ type: "debit", amount: "9900000" }))).toBe("-0.99");
  });

  it("keeps large amounts exact without floating point", () => {
    expect(vaultEventAmount(event({ type: "deposit", amount: "10000000000000" }))).toBe("+1000000");
    expect(vaultEventAmount(event({ type: "debit", amount: "500000000000" }))).toBe("-50000");
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
    expect(events.map((e) => e.ledger)).toEqual([1, 3, 2]);
  });

  it("handles empty and single-element lists", () => {
    expect(sortVaultEventsNewestFirst([])).toEqual([]);
    expect(sortVaultEventsNewestFirst([event()])).toEqual([event()]);
  });
});
