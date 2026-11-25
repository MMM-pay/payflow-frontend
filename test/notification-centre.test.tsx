// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationCentre } from "@/components/NotificationCentre";
import type { AppNotification } from "@/lib/notifications";
import { I18nProvider } from "@/i18n/provider";

afterEach(() => {
  cleanup();
});

function createMockStorage(initialData: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initialData));
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

const sampleNotifications: AppNotification[] = [
  {
    id: "notif-1",
    category: "low_balance",
    tone: "error",
    title: "Low vault balance",
    message: "Covers only 1 upcoming charge. Deposit funds now.",
    actionLabel: "Fund vault",
    actionHref: "#fund-vault",
  },
  {
    id: "notif-2",
    category: "failed_charge",
    tone: "error",
    title: "Failed charge: Mandate #42",
    message: "Subscriber balance short by 5 XLM.",
    actionLabel: "View subscriber",
  },
];

describe("NotificationCentre Component", () => {
  it("renders trigger button with unread count badge", () => {
    const storage = createMockStorage();
    render(
      <I18nProvider>
        <NotificationCentre
          notifications={sampleNotifications}
          storage={storage}
          address="GUSER1"
        />
      </I18nProvider>
    );

    const trigger = screen.getByRole("button", { name: /Notifications \(2\)/i });
    expect(trigger).toBeDefined();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("2")).toBeDefined();
  });

  it("expands panel on click and shows active notifications", () => {
    const storage = createMockStorage();
    render(
      <I18nProvider>
        <NotificationCentre
          notifications={sampleNotifications}
          storage={storage}
          address="GUSER1"
        />
      </I18nProvider>
    );

    const trigger = screen.getByRole("button", { name: /Notifications/i });
    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Low vault balance")).toBeDefined();
    expect(screen.getByText("Failed charge: Mandate #42")).toBeDefined();
    expect(screen.getByRole("link", { name: "Fund vault" }).getAttribute("href")).toBe("#fund-vault");
  });

  it("handles loading state properly", () => {
    const storage = createMockStorage();
    render(
      <I18nProvider>
        <NotificationCentre
          loading={true}
          defaultOpen={true}
          storage={storage}
        />
      </I18nProvider>
    );

    const loadingStatuses = screen.getAllByRole("status");
    expect(loadingStatuses.some((el) => el.getAttribute("aria-busy") === "true")).toBe(true);
    expect(screen.getByText(/Checking notifications…/i)).toBeDefined();
  });

  it("handles error state properly", () => {
    const storage = createMockStorage();
    render(
      <I18nProvider>
        <NotificationCentre
          error="Failed to load notifications from network"
          defaultOpen={true}
          storage={storage}
        />
      </I18nProvider>
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeDefined();
    expect(screen.getByText("Failed to load notifications from network")).toBeDefined();
  });

  it("handles empty state when there are no notifications", () => {
    const storage = createMockStorage();
    render(
      <I18nProvider>
        <NotificationCentre
          notifications={[]}
          defaultOpen={true}
          storage={storage}
        />
      </I18nProvider>
    );

    expect(screen.getByText("No new notifications")).toBeDefined();
    expect(
      screen.getByText(/All caught up! Important notices about balances and charges will appear here./i)
    ).toBeDefined();
  });

  it("dismisses an individual notification and updates storage", () => {
    const storage = createMockStorage();
    const onDismiss = vi.fn();

    render(
      <I18nProvider>
        <NotificationCentre
          notifications={sampleNotifications}
          defaultOpen={true}
          storage={storage}
          address="GUSER1"
          onDismiss={onDismiss}
        />
      </I18nProvider>
    );

    expect(screen.getByText("Low vault balance")).toBeDefined();
    expect(screen.getByText("Failed charge: Mandate #42")).toBeDefined();

    const dismissFirst = screen.getByRole("button", {
      name: /Dismiss notification: Low vault balance/i,
    });
    fireEvent.click(dismissFirst);

    expect(onDismiss).toHaveBeenCalledWith("notif-1");
    expect(screen.queryByText("Low vault balance")).toBeNull();
    expect(screen.getByText("Failed charge: Mandate #42")).toBeDefined();

    // Verify storage persistence
    const saved = storage.getItem("payflow.notifications.dismissed.GUSER1");
    expect(saved).toBeTruthy();
    expect(JSON.parse(saved!)).toContain("notif-1");
  });

  it("dismisses all notifications via Clear all button", () => {
    const storage = createMockStorage();
    const onClearAll = vi.fn();

    render(
      <I18nProvider>
        <NotificationCentre
          notifications={sampleNotifications}
          defaultOpen={true}
          storage={storage}
          address="GUSER1"
          onClearAll={onClearAll}
        />
      </I18nProvider>
    );

    const clearAllButton = screen.getByRole("button", { name: /Dismiss all/i });
    fireEvent.click(clearAllButton);

    expect(onClearAll).toHaveBeenCalled();
    // Transitions to empty state
    expect(screen.getByText("No new notifications")).toBeDefined();

    const saved = storage.getItem("payflow.notifications.dismissed.GUSER1");
    expect(JSON.parse(saved!)).toEqual(expect.arrayContaining(["notif-1", "notif-2"]));
  });

  it("respects previously dismissed items from storage on initial render", () => {
    const storage = createMockStorage({
      "payflow.notifications.dismissed.GUSER1": JSON.stringify(["notif-1"]),
    });

    render(
      <I18nProvider>
        <NotificationCentre
          notifications={sampleNotifications}
          defaultOpen={true}
          storage={storage}
          address="GUSER1"
        />
      </I18nProvider>
    );

    expect(screen.queryByText("Low vault balance")).toBeNull();
    expect(screen.getByText("Failed charge: Mandate #42")).toBeDefined();
  });

  it("closes panel on Escape key", () => {
    const storage = createMockStorage();
    render(
      <I18nProvider>
        <NotificationCentre
          notifications={sampleNotifications}
          defaultOpen={true}
          storage={storage}
        />
      </I18nProvider>
    );

    const section = screen.getByRole("region", { name: /Notification centre/i });
    fireEvent.keyDown(section, { key: "Escape" });

    const trigger = screen.getByRole("button", { name: /Notifications/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("applies theme-aware danger styles for error notices", () => {
    const storage = createMockStorage();
    const { container } = render(
      <I18nProvider>
        <NotificationCentre
          notifications={[sampleNotifications[0]!]}
          defaultOpen={true}
          storage={storage}
        />
      </I18nProvider>
    );

    const item = container.querySelector("li");
    expect(item?.className).toContain("text-danger");
    expect(item?.className).toContain("border-danger/40");
  });
});
