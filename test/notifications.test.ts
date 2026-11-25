import { describe, expect, it } from "vitest";
import {
  evaluateMerchantNotifications,
  evaluateSubscriberNotifications,
  filterDismissedNotifications,
  notificationStorageKey,
  parseDismissedIds,
  readDismissedIds,
  serializeDismissedIds,
  writeDismissedIds,
  type AppNotification,
} from "@/lib/notifications";
import type { VaultRunway } from "@/lib/runway";
import type { UnpaidMandate } from "@/lib/chain";

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("notifications pure helpers", () => {
  it("generates namespaced storage keys with address and global fallback", () => {
    expect(notificationStorageKey("GABC123")).toBe("payflow.notifications.dismissed.GABC123");
    expect(notificationStorageKey("  GXYZ  ")).toBe("payflow.notifications.dismissed.GXYZ");
    expect(notificationStorageKey("")).toBe("payflow.notifications.dismissed.global");
    expect(notificationStorageKey(null)).toBe("payflow.notifications.dismissed.global");
    expect(notificationStorageKey(undefined)).toBe("payflow.notifications.dismissed.global");
  });

  it("parses dismissed IDs safely from JSON", () => {
    expect(parseDismissedIds(null)).toEqual(new Set());
    expect(parseDismissedIds("")).toEqual(new Set());
    expect(parseDismissedIds("not json")).toEqual(new Set());
    expect(parseDismissedIds('{"not": "array"}')).toEqual(new Set());
    expect(parseDismissedIds('["notice-1", "notice-2", 123, null, ""]')).toEqual(
      new Set(["notice-1", "notice-2"])
    );
  });

  it("serializes dismissed IDs to JSON string", () => {
    const ids = new Set(["a", "b"]);
    const raw = serializeDismissedIds(ids);
    expect(JSON.parse(raw)).toEqual(["a", "b"]);
  });

  it("reads and writes dismissed IDs through storage", () => {
    const storage = createMockStorage();
    expect(readDismissedIds(storage, "GUSER")).toEqual(new Set());

    writeDismissedIds(storage, "GUSER", new Set(["notif-1", "notif-2"]));
    expect(readDismissedIds(storage, "GUSER")).toEqual(new Set(["notif-1", "notif-2"]));

    // Storage is namespaced per user
    expect(readDismissedIds(storage, "GOTHER")).toEqual(new Set());
  });

  it("tolerates throwing storage gracefully", () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("SecurityError: Access is denied");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    expect(readDismissedIds(throwingStorage, "GUSER")).toEqual(new Set());
    expect(() => writeDismissedIds(throwingStorage, "GUSER", new Set(["a"]))).not.toThrow();
  });

  it("filters out dismissed notifications", () => {
    const items: AppNotification[] = [
      { id: "1", category: "low_balance", tone: "error", title: "A", message: "m1" },
      { id: "2", category: "failed_charge", tone: "error", title: "B", message: "m2" },
      { id: "3", category: "system", tone: "info", title: "C", message: "m3" },
    ];

    const dismissed = new Set(["2"]);
    const filtered = filterDismissedNotifications(items, dismissed);
    expect(filtered.map((i) => i.id)).toEqual(["1", "3"]);
  });
});

describe("evaluateSubscriberNotifications", () => {
  it("returns empty when runway is null or balance is healthy", () => {
    expect(evaluateSubscriberNotifications({ runway: null })).toEqual([]);

    const healthyRunway: VaultRunway = {
      chargesCovered: 5,
      runsOutDate: null,
      isLow: false,
      activeMandatesCount: 2,
      hasActiveMandates: true,
    };
    expect(evaluateSubscriberNotifications({ runway: healthyRunway })).toEqual([]);
  });

  it("returns low_balance notification when runway is low with active mandates", () => {
    const lowRunway: VaultRunway = {
      chargesCovered: 1,
      runsOutDate: 1780000000,
      isLow: true,
      activeMandatesCount: 1,
      hasActiveMandates: true,
    };

    const notifs = evaluateSubscriberNotifications({ runway: lowRunway });
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.id).toBe("low-vault-balance");
    expect(notifs[0]?.category).toBe("low_balance");
    expect(notifs[0]?.tone).toBe("error");
    expect(notifs[0]?.message).toContain("Covers only 1 upcoming charge.");
    expect(notifs[0]?.actionLabel).toBe("Fund vault");
  });

  it("handles plural upcoming charges when chargesCovered is 0 or 2+", () => {
    const zeroRunway: VaultRunway = {
      chargesCovered: 0,
      runsOutDate: null,
      isLow: true,
      activeMandatesCount: 1,
      hasActiveMandates: true,
    };

    const notifs = evaluateSubscriberNotifications({ runway: zeroRunway });
    expect(notifs[0]?.message).toContain("Covers only 0 upcoming charges.");
  });

  it("collects failed charge attempts", () => {
    const notifs = evaluateSubscriberNotifications({
      runway: null,
      chargeAttempts: [
        {
          id: 101,
          mandate_id: 42,
          attempted_at: 1780001000,
          result: "failed",
          error_code: 3,
          error_message: "Vault balance short",
          tx_hash: null,
        },
        {
          id: 102,
          mandate_id: 42,
          attempted_at: 1780002000,
          result: "success",
          error_code: null,
          error_message: null,
          tx_hash: "abcd",
        },
      ],
    });

    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.id).toBe("failed-charge-101");
    expect(notifs[0]?.category).toBe("failed_charge");
    expect(notifs[0]?.title).toContain("Mandate #42");
    expect(notifs[0]?.message).toBe("Vault balance short");
  });
});

describe("evaluateMerchantNotifications", () => {
  it("returns empty when unpaidMandates is null or empty", () => {
    expect(evaluateMerchantNotifications({ unpaidMandates: null })).toEqual([]);
    expect(evaluateMerchantNotifications({ unpaidMandates: [] })).toEqual([]);
  });

  it("generates notifications for unpaid subscriber shortfalls", () => {
    const unpaid: UnpaidMandate[] = [
      {
        mandate: {
          id: 77,
          plan_id: 1,
          subscriber: "GSUB1",
          merchant: "GMERCH",
          amount: "10000000",
          period: 86400,
          next_charge: 1780000000,
          last_charge: 1779900000,
          charges_made: 1,
          max_charges: 0,
          fee_bps: 0,
          status: "Active",
          token: "CDLZ",
        },
        shortfall: 10000000n,
        overdueDuration: 3600,
      },
    ];

    let actionTriggered = false;
    const notifs = evaluateMerchantNotifications({
      unpaidMandates: unpaid,
      tokenMeta: { symbol: "XLM", decimals: 7 },
      onSelectUnpaidTab: () => {
        actionTriggered = true;
      },
    });

    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.id).toBe("unpaid-mandate-77");
    expect(notifs[0]?.category).toBe("unpaid_mandate");
    expect(notifs[0]?.title).toContain("Mandate #77");
    expect(notifs[0]?.message).toContain("1 XLM");
    expect(notifs[0]?.actionLabel).toBe("View subscriber");

    notifs[0]?.onAction?.();
    expect(actionTriggered).toBe(true);
  });
});
