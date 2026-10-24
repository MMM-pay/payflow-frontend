import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ONBOARDING_DISMISSED_KEY,
  computeOnboardingItems,
  isOnboardingComplete,
  shouldShowOnboarding,
  readDismissed,
  writeDismissed,
  isFunded,
  hasPublishedPlan,
  type OnboardingInput,
} from "../src/lib/onboarding";
import type { Mandate } from "../src/lib/payflow";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function mandate(id: bigint): Mandate {
  return { id } as unknown as Mandate;
}

const baseInput: OnboardingInput = {
  balance: null,
  mandates: [],
  subscriberCount: 0,
  sharedLink: false,
};

describe("onboarding checklist", () => {
  it("derives four items in order", () => {
    const items = computeOnboardingItems(baseInput);
    expect(items.map((i) => i.id)).toEqual([
      "fund-wallet",
      "publish-plan",
      "share-link",
      "see-subscriber",
    ]);
    expect(items.every((i) => !i.done)).toBe(true);
  });

  it("requires a balance before funding is considered complete", () => {
    const items = computeOnboardingItems({ ...baseInput, balance: null });
    const fund = items.find((i) => i.id === "fund-wallet");
    expect(fund?.done).toBe(false);
  });

  it("marks fund-wallet complete when balance meets threshold", () => {
    const items = computeOnboardingItems({
      ...baseInput,
      balance: 10_000_000n,
    });
    expect(items[0]?.done).toBe(true);
  });

  it("treats a zero balance as not funded", () => {
    expect(isFunded(0n)).toBe(false);
    expect(isFunded(null)).toBe(false);
  });

  it("marks publish-plan complete when a mandate exists", () => {
    expect(hasPublishedPlan([])).toBe(false);
    const items = computeOnboardingItems({
      ...baseInput,
      mandates: [mandate(1n)],
    });
    expect(items[1]?.done).toBe(true);
  });

  it("share-link is complete after sharing or once a subscriber exists", () => {
    const notShared = computeOnboardingItems(baseInput);
    expect(notShared[2]?.done).toBe(false);
    const shared = computeOnboardingItems({ ...baseInput, sharedLink: true });
    expect(shared[2]?.done).toBe(true);
    const withSub = computeOnboardingItems({ ...baseInput, subscriberCount: 1 });
    expect(withSub[2]?.done).toBe(true);
  });

  it("marks see-subscriber complete when subscriberCount >= 1", () => {
    const items = computeOnboardingItems({ ...baseInput, subscriberCount: 1 });
    expect(items[3]?.done).toBe(true);
  });

  it("detects completion and visibility", () => {
    const incomplete = computeOnboardingItems(baseInput);
    expect(isOnboardingComplete(incomplete)).toBe(false);
    expect(shouldShowOnboarding(incomplete, false)).toBe(true);
    expect(shouldShowOnboarding(incomplete, true)).toBe(false);

    const complete = computeOnboardingItems({
      balance: 10_000_000n,
      mandates: [mandate(1n)],
      subscriberCount: 1,
      sharedLink: true,
    });
    expect(isOnboardingComplete(complete)).toBe(true);
    expect(shouldShowOnboarding(complete, false)).toBe(false);
  });
});

describe("onboarding dismissal persistence", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  afterEach(() => {
    storage.clear();
  });

  it("returns not-dismissed when nothing is stored", () => {
    expect(readDismissed(storage)).toBe(false);
  });

  it("persists dismissal across loads", () => {
    writeDismissed(storage, true);
    expect(storage.getItem(ONBOARDING_DISMISSED_KEY)).toBe("1");
    expect(readDismissed(storage)).toBe(true);
  });

  it("resets the dismissal", () => {
    writeDismissed(storage, true);
    writeDismissed(storage, false);
    expect(readDismissed(storage)).toBe(false);
  });

  it("works without any storage available", () => {
    expect(readDismissed(null)).toBe(false);
    expect(() => writeDismissed(null, true)).not.toThrow();
    expect(readDismissed(undefined)).toBe(false);
  });

  it("tolerates storage that throws", () => {
    const throwing = {
      getItem(): string | null {
        throw new Error("denied");
      },
    };
    expect(readDismissed(throwing)).toBe(false);
  });
});
