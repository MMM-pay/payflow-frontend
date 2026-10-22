import { describe, expect, it } from "vitest";
import type { ApiMandate } from "@/lib/api";
import {
  REMINDER_LEAD_MS,
  addReminder,
  buildReminderSchedule,
  hasReminder,
  parseReminderPrefs,
  pruneEndedReminders,
  readReminderPrefs,
  reminderAt,
  reminderEligible,
  reminderStorageKey,
  removeReminder,
  saveReminderPrefs,
  serializeReminderPrefs,
} from "@/lib/reminders";

const DAY = 86_400;

function mandate(overrides: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 7,
    subscriber: "GSUBS",
    merchant: "GMERCHANT",
    plan_id: 1,
    amount: "10000000",
    period: 2_592_000,
    next_charge: 2_000_000_000,
    last_charge: 0,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
    ...overrides,
  };
}

describe("reminder timing (#174)", () => {
  it("fires one day before the charge", () => {
    const nextCharge = 2_000_000_000;
    expect(reminderAt(nextCharge, nextCharge * 1000 - 2 * DAY * 1000)).toBe(
      nextCharge * 1000 - REMINDER_LEAD_MS,
    );
  });

  it("is due now when the subscriber opts in late, but not after the charge", () => {
    const nextCharge = 2_000_000_000;
    const now = nextCharge * 1000 - 60_000;
    expect(reminderAt(nextCharge, now)).toBe(now);
    expect(reminderAt(nextCharge, nextCharge * 1000 + 1)).toBeNull();
  });

  it("ignores mandates with no scheduled charge", () => {
    expect(reminderAt(0, 1_000)).toBeNull();
    expect(reminderAt(Number.NaN, 1_000)).toBeNull();
    expect(reminderEligible(mandate({ next_charge: 0 }))).toBe(false);
  });
});

describe("reminder eligibility uses mandateStatus (#174)", () => {
  it("accepts only Active mandates", () => {
    expect(reminderEligible(mandate({ status: "Active" }))).toBe(true);
    // Contract state decodes as a one-element tuple.
    expect(reminderEligible(mandate({ status: ["Active"] as unknown as string }))).toBe(true);
    expect(reminderEligible(mandate({ status: "Paused" }))).toBe(false);
    expect(reminderEligible(mandate({ status: ["Cancelled"] as unknown as string }))).toBe(false);
  });

  it("builds a schedule only for opted-in, active mandates", () => {
    const now = 1_000_000_000_000;
    const active = mandate({ id: 1, next_charge: now / 1000 + 2 * DAY });
    const cancelled = mandate({
      id: 2,
      status: ["Cancelled"] as unknown as string,
      next_charge: now / 1000 + 2 * DAY,
    });
    const paused = mandate({ id: 3, status: "Paused", next_charge: now / 1000 + 2 * DAY });
    const notOptedIn = mandate({ id: 4, next_charge: now / 1000 + 2 * DAY });

    const schedule = buildReminderSchedule(
      [active, cancelled, paused, notOptedIn],
      { "1": true, "2": true, "3": true },
      now,
    );

    expect(schedule).toHaveLength(1);
    expect(schedule[0]).toMatchObject({
      mandateId: 1,
      nextCharge: active.next_charge,
      tag: "payflow-mandate-1",
      at: active.next_charge * 1000 - REMINDER_LEAD_MS,
    });
    expect(schedule[0]?.body).toContain("Mandate #1");
  });
});

describe("reminder preferences (#174)", () => {
  it("adds and removes preferences by mandate id", () => {
    const withOne = addReminder({}, 7);
    expect(hasReminder(withOne, 7)).toBe(true);
    expect(hasReminder(removeReminder(withOne, 7), 7)).toBe(false);
  });

  it("round-trips through storage under an address-specific key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const prefs = addReminder({}, 3);
    saveReminderPrefs(storage, "GABC", prefs);

    expect(values.has(reminderStorageKey("GABC"))).toBe(true);
    expect(readReminderPrefs(storage, "GABC")).toEqual({ "3": true });
    // A different wallet must not inherit the first wallet's reminders.
    expect(readReminderPrefs(storage, "GOTHER")).toEqual({});
  });

  it("ignores corrupt or unexpected storage instead of throwing", () => {
    expect(parseReminderPrefs("{")).toEqual({});
    expect(parseReminderPrefs("[1,2]")).toEqual({});
    expect(parseReminderPrefs('{"7":false,"8":true,"x":true}')).toEqual({ "8": true });
    expect(parseReminderPrefs(serializeReminderPrefs({ "1": true }))).toEqual({ "1": true });
  });

  it("cancels reminders when a mandate is cancelled or completed", () => {
    const prefs = { "1": true, "2": true, "3": true, "4": true } as const;
    const result = pruneEndedReminders(prefs, [
      mandate({ id: 1, status: "Active" }),
      mandate({ id: 2, status: ["Cancelled"] as unknown as string }),
      mandate({ id: 3, status: "Completed" }),
      mandate({ id: 4, status: "Paused" }),
    ]);

    expect(result.removed).toEqual([2, 3]);
    expect(result.prefs).toEqual({ "1": true, "4": true });
    expect(pruneEndedReminders(prefs, []).prefs).toEqual(prefs);
  });
});
