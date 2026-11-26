import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { AmountInput } from "@/components/AmountInput";
import { CohortRetentionTable } from "@/components/CohortRetentionTable";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ContractVersionNotice } from "@/components/ContractVersionNotice";
import { CopyButton } from "@/components/CopyButton";
import { DepositCoverageInput } from "@/components/DepositCoverageInput";
import { HeaderSearch } from "@/components/HeaderSearch";
import { LoadingButton } from "@/components/LoadingButton";
import { Money } from "@/components/Money";
import { NotificationCentre } from "@/components/NotificationCentre";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { QrCode } from "@/components/QrCode";
import { RevenueChart } from "@/components/RevenueChart";
import { Search } from "@/components/Search";
import { SectionShortcuts } from "@/components/SectionShortcuts";
import { SubscriberGuide } from "@/components/SubscriberGuide";
import { SyncLagIndicator } from "@/components/SyncLagIndicator";
import { ThemeToggle } from "@/components/ThemeToggle";
import { VirtualList } from "@/components/VirtualList";
import { XLM, type TokenMeta } from "@/lib/format";
import type { RevenuePoint } from "@/lib/revenue";
import type { AppNotification } from "@/lib/notifications";

const meta = {
  title: "Shared/Components",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const USDC: TokenMeta = { symbol: "USDC", decimals: 6 };

export const MoneyStates: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-6">
        <Money amount={12_345_678n} meta={XLM} />
        <Money amount={1_234_567n} meta={USDC} />
        <Money amount={0n} meta={XLM} />
        <Money amount={-2_500_000n} meta={USDC} />
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <Money amount={null} loading />
        <Money amount={null} />
        <Money amount="not-an-amount" />
      </div>
    </div>
  ),
};

function AmountInputExample({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <div className="max-w-sm">
      <AmountInput
        id="story-amount"
        label="Amount (XLM)"
        value={value}
        onChange={setValue}
        decimals={7}
        hint="The entered precision is validated without truncation."
      />
    </div>
  );
}

export const AmountInputStates: Story = {
  render: () => <AmountInputExample initialValue="12.3456789" />,
};

export const AmountInputInvalid: Story = {
  render: () => <AmountInputExample initialValue="12.34567891" />,
};

export const ActionControls: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <LoadingButton onClick={() => undefined}>Save changes</LoadingButton>
      <LoadingButton variant="ghost" disabled>Unavailable</LoadingButton>
      <LoadingButton loading loadingText="Saving…">Save changes</LoadingButton>
      <CopyButton
        value="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        label="example address"
      />
    </div>
  ),
};

export const CopyButtonInteraction: Story = {
  render: () => (
    <CopyButton
      value="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      label="example address"
    />
  ),
  play: async ({ canvasElement }) => {
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const copiedValues: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => copiedValues.push(value) },
    });

    try {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "Copy example address" }));
      await expect(canvas.getByRole("status").textContent).toBe(
        "example address copied to clipboard",
      );
      await expect(copiedValues).toEqual([
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      ]);
    } finally {
      if (previousClipboard) {
        Object.defineProperty(navigator, "clipboard", previousClipboard);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  },
};

function SearchExample() {
  const [value, setValue] = useState("monthly");
  return (
    <div className="max-w-md">
      <Search value={value} onChange={setValue} />
    </div>
  );
}

export const SearchControls: Story = {
  render: () => <SearchExample />,
};

export const SearchEmpty: Story = {
  render: () => <div className="max-w-md"><Search value="" onChange={() => undefined} /></div>,
};

export const HeaderSearchEmpty: Story = {
  name: "HeaderSearch — idle",
  render: () => <div className="max-w-sm"><HeaderSearch onNavigate={() => undefined} /></div>,
};

export const ConfirmationDialog: Story = {
  render: () => (
    <ConfirmDialog
      open
      title="Cancel this subscription?"
      confirmLabel="Confirm cancellation"
      onCancel={() => undefined}
      onConfirm={() => undefined}
    >
      Future charges will stop. The remaining vault balance stays yours.
    </ConfirmDialog>
  ),
};

export const DepositCoverage: Story = {
  render: () => (
    <div className="max-w-xl">
      <DepositCoverageInput
        planAmount="10000000"
        decimals={7}
        symbol="XLM"
        onDeposit={() => undefined}
      />
    </div>
  ),
};

export const Notifications: Story = {
  render: () => {
    const storage: Storage = {
      get length() { return 0; },
      clear: () => undefined,
      getItem: () => null,
      key: () => null,
      removeItem: () => undefined,
      setItem: () => undefined,
    };
    const notifications: AppNotification[] = [
      {
        id: "low-balance",
        category: "low_balance",
        tone: "warn",
        title: "Vault running low",
        message: "Add funds before the next scheduled charge.",
        actionLabel: "Open account",
        actionHref: "/account",
      },
      {
        id: "failed-charge",
        category: "failed_charge",
        tone: "error",
        title: "A charge needs attention",
        message: "The subscriber vault did not have enough balance.",
      },
    ];
    return (
      <div className="max-w-2xl">
        <NotificationCentre
          notifications={notifications}
          defaultOpen
          storage={storage}
          onDismiss={() => undefined}
          onClearAll={() => undefined}
        />
      </div>
    );
  },
};

export const OnboardingProgress: Story = {
  render: () => (
    <div className="max-w-lg">
      <OnboardingChecklist
        address={null}
        state={{
          fundWallet: true,
          publishPlan: true,
          shareLink: false,
          firstSubscriber: false,
        }}
        onDismiss={() => undefined}
      />
    </div>
  ),
};

export const QrCodeExample: Story = {
  render: () => (
    <QrCode
      data="https://payflow.example/subscribe/?plan=12"
      label="Example monthly plan subscription link"
    />
  ),
};

const REVENUE_POINTS: RevenuePoint[] = [
  { start: 1_763_942_400, gross: 12_500_000n, fee: 125_000n, net: 12_375_000n },
  { start: 1_764_028_800, gross: 8_000_000n, fee: 80_000n, net: 7_920_000n },
  { start: 1_764_115_200, gross: 0n, fee: 0n, net: 0n },
];

export const RevenueChartExample: Story = {
  render: () => (
    <div className="max-w-3xl">
      <RevenueChart points={REVENUE_POINTS} size="day" meta={XLM} />
    </div>
  ),
};

export const VirtualizedRows: Story = {
  render: () => {
    const items = Array.from({ length: 120 }, (_, id) => ({
      id,
      name: `Subscriber ${String(id + 1).padStart(3, "0")}`,
    }));
    return (
      <VirtualList
        items={items}
        threshold={20}
        itemHeight={56}
        containerMaxHeight={280}
        overscan={3}
        keyExtractor={(item) => item.id}
        listAriaLabel="Example subscribers"
        renderItem={(item) => (
          <div className="border-b border-edge px-3 py-4 text-sm">{item.name}</div>
        )}
      />
    );
  },
};

export const CohortRetentionUnavailable: Story = {
  name: "CohortRetentionTable — backend unavailable",
  render: () => (
    <div className="max-w-3xl">
      <CohortRetentionTable merchant="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" apiConfigured={false} />
    </div>
  ),
};

export const ContractDrift: Story = {
  render: () => (
    <ContractVersionNotice
      drift={{
        newer: true,
        unknownFields: ["new_status_field"],
        unknownStatus: "PausedByProtocol",
      }}
    />
  ),
};

export const SyncStatusVariants: Story = {
  render: () => (
    <div className="space-y-3">
      <SyncLagIndicator
        state={{ state: "catching_up", isCatchingUp: true, lag: 18, paused: false }}
      />
      <SyncLagIndicator state={{ loading: true, isCatchingUp: false }} showLoading />
      <SyncLagIndicator
        state={{ state: "error", isCatchingUp: false, error: "Health check unavailable" }}
        showError
      />
      <SyncLagIndicator
        state={{ state: "synced", isCatchingUp: false, lag: 0 }}
        renderEmpty
      />
    </div>
  ),
};

export const SectionNavigationHint: Story = {
  render: () => (
    <main className="space-y-4">
      <SectionShortcuts />
      <section className="panel"><h2>Overview</h2><p>First dashboard section.</p></section>
      <section className="panel"><h2>Activity</h2><p>Second dashboard section.</p></section>
    </main>
  ),
};

export const SubscriberGettingStarted: Story = {
  render: () => <div className="max-w-3xl"><SubscriberGuide /></div>,
};

export const ThemeToggleControl: Story = {
  render: () => <ThemeToggle />,
};
