import type { Mandate } from "@/lib/payflow";

export interface OnboardingItem {
  id: OnboardingItemId;
  title: string;
  description: string;
  done: boolean;
}

export type OnboardingItemId =
  | "fund-wallet"
  | "publish-plan"
  | "share-link"
  | "see-subscriber";

export const ONBOARDING_DISMISSED_KEY = "payflow:onboarding-dismissed";

export const ORDER: OnboardingItemId[] = [
  "fund-wallet",
  "publish-plan",
  "share-link",
  "see-subscriber",
];

export interface OnboardingInput {
  /** Wallet balance in strops (bigint), null when unknown. */
  balance: bigint | null;
  /** Mandates (published plans) owned by the merchant. */
  mandates: Mandate[];
  /** Total subscriber count across the merchant's mandates. */
  subscriberCount: number;
  /** Whether the merchant has copied/shared a subscribe link. */
  sharedLink: boolean;
}

/** Minimum balance (in strops) to consider the wallet funded. */
/** One XLM, in stroops: a lumen is 10^7 stroops, not 10^8. */
export const FUNDED_THRESHOLD = 10_000_000n;

export function isFunded(balance: bigint | null): boolean {
  if (balance === null) return false;
  return balance >= FUNDED_THRESHOLD;
}

export function hasPublishedPlan(mandates: Mandate[]): boolean {
  return mandates.length > 0;
}

export function computeOnboardingItems(input: OnboardingInput): OnboardingItem[] {
  const done: Record<OnboardingItemId, boolean> = {
    "fund-wallet": isFunded(input.balance),
    "publish-plan": hasPublishedPlan(input.mandates),
    "share-link": input.sharedLink || input.subscriberCount > 0,
    "see-subscriber": input.subscriberCount > 0,
  };

  const meta: Record<OnboardingItemId, { title: string; description: string }> = {
    "fund-wallet": {
      title: "Fund your wallet",
      description:
        "Add testnet XLM with Friendbot so you can sign contract writes.",
    },
    "publish-plan": {
      title: "Publish a plan",
      description: "Create a merchant mandate with a price and interval.",
    },
    "share-link": {
      title: "Share your subscribe link",
      description: "Send the plan link to a customer so they can subscribe.",
    },
    "see-subscriber": {
      title: "See your first subscriber",
      description: "Watch a subscriber appear on your dashboard.",
    },
  };

  return ORDER.map((id) => ({
    id,
    title: meta[id].title,
    description: meta[id].description,
    done: done[id],
  }));
}

export function isOnboardingComplete(items: OnboardingItem[]): boolean {
  return items.length > 0 && items.every((item) => item.done);
}

export function shouldShowOnboarding(items: OnboardingItem[], dismissed: boolean): boolean {
  if (dismissed) return false;
  return !isOnboardingComplete(items);
}

export function readDismissed(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(ONBOARDING_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDismissed(
  storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined,
  dismissed: boolean,
): void {
  if (!storage) return;
  try {
    if (dismissed) {
      storage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    } else {
      storage.removeItem(ONBOARDING_DISMISSED_KEY);
    }
  } catch {
    // Storage may be unavailable (private mode, quota). Dismissal is non-critical.
  }
}
