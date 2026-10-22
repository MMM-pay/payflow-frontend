import type { ApiMandate } from "./api";
import { formatDate } from "./format";
import { mandateStatus } from "./mandate-status";

/**
 * Opt-in browser reminders the day before a mandate is charged.
 *
 * The feature is deliberately small and local:
 *
 * - Nothing asks for notification permission on load. The prompt is trigged
 *   only from `requestPermission` when the subscriber clicks "Remind me".
 * - Preferences are per wallet address and per mandate id, stored in
 *   `localStorage`, so switching accounts cannot inherit another subscriber's
 *   choices.
 * - Scheduling is derived from the same mandate list the page already shows.
 *   It therefore works in contract-only mode: no backend call is involved.
 * - A mandate in a terminal state (`Cancelled` or `Completed`) removes its
 *   reminder. Status is read with `mandateStatus` because contract state
 *   decodes as `["Active"]`, while the indexer sends `"Active"`.
 *
 * The browser half lives in the account page and service worker. This module
 * is pure so the schedule can be tested without rendering React or touching
 * the Notification API.
 */

/** One day before the charge, in milliseconds. */
export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

/** Storage is namespaced by address: `payflow.reminders.<address>`. */
export const REMINDER_STORAGE_PREFIX = "payflow.reminders.";

/** Mandate ids the subscriber opted in for. */
export type ReminderPrefs = Record<string, true>;

/** A notification the page should show, with everything needed to schedule it. */
export interface ScheduledReminder {
  mandateId: number;
  /** Unix milliseconds when the notification should appear. */
  at: number;
  /** Unix seconds of the charge it warns about. */
  nextCharge: number;
  title: string;
  body: string;
  /** Stable tag so a re-render replaces rather than duplicates the notification. */
  tag: string;
}

export function reminderStorageKey(address: string): string {
  return `${REMINDER_STORAGE_PREFIX}${address}`;
}

/**
 * Read the stored preferences for an address.
 *
 * Corrupt JSON, an array, or values that are not `true` all resolve to an empty
 * map: a broken storage entry should forget reminders, not crash the account
 * page. Numeric keys in JSON arrive as strings, which is exactly how the map is
 * keyed.
 */
export function parseReminderPrefs(raw: string | null | undefined): ReminderPrefs {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const prefs: ReminderPrefs = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === true && /^\d+$/.test(key)) prefs[key] = true;
    }
    return prefs;
  } catch {
    return {};
  }
}

export function serializeReminderPrefs(prefs: ReminderPrefs): string {
  return JSON.stringify(prefs);
}

/** Read an address's preferences from storage, tolerating unavailable storage. */
export function readReminderPrefs(
  storage: Pick<Storage, "getItem"> | null | undefined,
  address: string | null | undefined,
): ReminderPrefs {
  if (!storage || !address) return {};
  try {
    return parseReminderPrefs(storage.getItem(reminderStorageKey(address)));
  } catch {
    return {};
  }
}

/** Persist an address's preferences. Storage failures are non-fatal. */
export function saveReminderPrefs(
  storage: Pick<Storage, "setItem"> | null | undefined,
  address: string | null | undefined,
  prefs: ReminderPrefs,
): void {
  if (!storage || !address) return;
  try {
    storage.setItem(reminderStorageKey(address), serializeReminderPrefs(prefs));
  } catch {
    // Private-mode storage can refuse writes; the in-memory state still works.
  }
}

export function hasReminder(prefs: ReminderPrefs, mandateId: number | string): boolean {
  return prefs[String(mandateId)] === true;
}

export function addReminder(prefs: ReminderPrefs, mandateId: number | string): ReminderPrefs {
  return { ...prefs, [String(mandateId)]: true };
}

export function removeReminder(prefs: ReminderPrefs, mandateId: number | string): ReminderPrefs {
  const next = { ...prefs };
  delete next[String(mandateId)];
  return next;
}

/** Whether a mandate will never charge again. */
export function mandateHasEnded(mandate: Pick<ApiMandate, "status">): boolean {
  const status = mandateStatus(mandate.status);
  return status === "Cancelled" || status === "Completed";
}

/** Whether this mandate could produce a reminder right now. */
export function reminderEligible(mandate: Pick<ApiMandate, "status" | "next_charge">): boolean {
  if (mandateStatus(mandate.status) !== "Active") return false;
  const next = Number(mandate.next_charge);
  return Number.isFinite(next) && next > 0;
}

/**
 * Drop preferences for mandates that have ended.
 *
 * Called with the latest mandate list, so a cancellation from the merchant or
 * from another tab stops this browser's reminder as soon as the account page
 * reloads. Ids absent from the list are kept: a partial page or an indexer
 * paginating results is not proof that the mandate ended.
 */
export function pruneEndedReminders(
  prefs: ReminderPrefs,
  mandates: readonly Pick<ApiMandate, "id" | "status">[],
): { prefs: ReminderPrefs; removed: number[] } {
  const next = { ...prefs };
  const removed: number[] = [];
  for (const mandate of mandates) {
    const key = String(mandate.id);
    if (next[key] && mandateHasEnded(mandate)) {
      delete next[key];
      removed.push(mandate.id);
    }
  }
  return { prefs: next, removed };
}

/**
 * When a reminder for `nextCharge` should fire, in Unix milliseconds.
 *
 * The charge time minus a day. If that moment has already passed but the
 * charge has not — a subscriber opted in the same afternoon — the reminder is
 * due now rather than skipped, and the page's timer fires immediately.
 * Charges in the past, malformed timestamps and zero (`next_charge` is 0 on a
 * mandate that has no scheduled charge) return null.
 */
export function reminderAt(
  nextCharge: number,
  nowMs: number = Date.now(),
  leadMs: number = REMINDER_LEAD_MS,
): number | null {
  if (!Number.isFinite(nextCharge) || nextCharge <= 0) return null;
  const chargeAt = nextCharge * 1000;
  if (!Number.isFinite(chargeAt) || chargeAt <= nowMs) return null;
  return Math.max(nowMs, chargeAt - leadMs);
}

/**
 * Build the notifications due for the current preference map.
 *
 * Only `Active` mandates with a future charge are scheduled: a paused mandate
 * has no charge to warn about, and a terminal one is removed by
 * `pruneEndedReminders`. A preference for a mandate that is no longer in the
 * list simply produces nothing.
 */
export function buildReminderSchedule(
  mandates: readonly Pick<
    ApiMandate,
    "id" | "status" | "next_charge" | "merchant"
  >[],
  prefs: ReminderPrefs,
  nowMs: number = Date.now(),
): ScheduledReminder[] {
  const scheduled: ScheduledReminder[] = [];
  for (const mandate of mandates) {
    if (!hasReminder(prefs, mandate.id) || !reminderEligible(mandate)) continue;
    const at = reminderAt(Number(mandate.next_charge), nowMs);
    if (at === null) continue;
    const nextCharge = Number(mandate.next_charge);
    scheduled.push({
      mandateId: mandate.id,
      at,
      nextCharge,
      title: "Upcoming Payflow charge",
      body: `Mandate #${mandate.id} is due to be charged on ${formatDate(nextCharge)}. Check your vault balance.`,
      tag: `payflow-mandate-${mandate.id}`,
    });
  }
  return scheduled.sort((a, b) => a.at - b.at || a.mandateId - b.mandateId);
}
