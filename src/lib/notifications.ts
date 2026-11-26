import type { ApiChargeAttempt, ApiMandate } from "./api";
import type { TokenMeta } from "./format";
import type { VaultRunway } from "./runway";
import type { UnpaidMandate } from "./chain";
import { formatAmount } from "./format";

export type NotificationCategory =
  | "low_balance"
  | "failed_charge"
  | "unpaid_mandate"
  | "system"
  | "custom";

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  tone: "error" | "warn" | "info" | "ok";
  title: string;
  message: string;
  timestamp?: number;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}

export const NOTIFICATION_STORAGE_PREFIX = "payflow.notifications.dismissed.";

export function notificationStorageKey(address: string | null | undefined): string {
  return `${NOTIFICATION_STORAGE_PREFIX}${address && address.trim() ? address.trim() : "global"}`;
}

/**
 * Safely parse a set of dismissed notification IDs from raw JSON storage.
 */
export function parseDismissedIds(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const result = new Set<string>();
    for (const item of parsed) {
      if (typeof item === "string" && item.trim().length > 0) {
        result.add(item.trim());
      }
    }
    return result;
  } catch {
    return new Set();
  }
}

/**
 * Serialize a set of dismissed notification IDs to JSON.
 */
export function serializeDismissedIds(ids: Set<string>): string {
  return JSON.stringify(Array.from(ids));
}

/**
 * Read dismissed notification IDs from storage for a given address.
 */
export function readDismissedIds(
  storage: Pick<Storage, "getItem"> | null | undefined,
  address: string | null | undefined,
): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(notificationStorageKey(address));
    return parseDismissedIds(raw);
  } catch {
    return new Set();
  }
}

/**
 * Persist dismissed notification IDs to storage for a given address.
 */
export function writeDismissedIds(
  storage: Pick<Storage, "setItem"> | null | undefined,
  address: string | null | undefined,
  ids: Set<string>,
): void {
  if (!storage) return;
  try {
    storage.setItem(notificationStorageKey(address), serializeDismissedIds(ids));
  } catch {
    // Tolerates quota exceeded or disabled storage in private browsing
  }
}

/**
 * Filters out dismissed notifications from the list.
 */
export function filterDismissedNotifications(
  notifications: AppNotification[],
  dismissed: Set<string>,
): AppNotification[] {
  return notifications.filter((n) => !dismissed.has(n.id));
}

/**
 * Evaluates notifications for the Subscriber portal (/account).
 * Collects low vault balance warnings, failing mandates, or failed charge attempts.
 */
export function evaluateSubscriberNotifications(params: {
  runway: VaultRunway | null;
  mandates?: ApiMandate[] | null;
  vaultMeta?: TokenMeta;
  chargeAttempts?: ApiChargeAttempt[] | null;
}): AppNotification[] {
  const { runway, chargeAttempts } = params;
  const items: AppNotification[] = [];

  // Low vault balance notification
  if (runway?.isLow && runway.hasActiveMandates) {
    const count = runway.chargesCovered;
    const countText = count === 1 ? "1 upcoming charge" : `${count} upcoming charges`;
    const message = runway.runsOutDate
      ? `Covers only ${countText}. Funds will run out soon. Deposit funds to avoid subscription interruption.`
      : `Covers only ${countText}. Deposit funds to avoid subscription interruption.`;

    items.push({
      id: "low-vault-balance",
      category: "low_balance",
      tone: "error",
      title: "Low vault balance",
      message,
      actionLabel: "Fund vault",
      actionHref: "#fund-vault",
    });
  }

  // Failed charge attempts for the subscriber
  if (chargeAttempts && chargeAttempts.length > 0) {
    for (const attempt of chargeAttempts) {
      if (attempt.result === "failed") {
        items.push({
          id: `failed-charge-${attempt.id}`,
          category: "failed_charge",
          tone: "error",
          title: `Failed charge: Mandate #${attempt.mandate_id}`,
          message: attempt.error_message || "Charge attempt failed on-chain.",
          timestamp: attempt.attempted_at,
          actionLabel: "Fund vault",
          actionHref: "#fund-vault",
        });
      }
    }
  }

  return items;
}

/**
 * Evaluates notifications for the Merchant dashboard (/merchant).
 * Collects unpaid mandates, subscriber balance shortfalls, and failed charge settlements.
 */
export function evaluateMerchantNotifications(params: {
  unpaidMandates?: UnpaidMandate[] | null;
  tokenMeta?: TokenMeta;
  onSelectUnpaidTab?: () => void;
}): AppNotification[] {
  const { unpaidMandates, tokenMeta, onSelectUnpaidTab } = params;
  const items: AppNotification[] = [];

  if (unpaidMandates && unpaidMandates.length > 0) {
    for (const unpaid of unpaidMandates) {
      const shortfallFormatted = tokenMeta
        ? formatAmount(unpaid.shortfall, tokenMeta)
        : `${unpaid.shortfall.toString()} stroops`;

      items.push({
        id: `unpaid-mandate-${unpaid.mandate.id}`,
        category: "unpaid_mandate",
        tone: "error",
        title: `Failed charge: Mandate #${unpaid.mandate.id}`,
        message: `Subscriber balance short by ${shortfallFormatted}. Mandate is overdue for settlement.`,
        actionLabel: "View subscriber",
        ...(onSelectUnpaidTab ? { onAction: onSelectUnpaidTab } : {}),
      });
    }
  }

  return items;
}
