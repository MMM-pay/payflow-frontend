import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  AddressLink,
  Badge,
  Dialog,
  Empty,
  MerchantAccount,
  NetworkMismatchBanner,
  Notice,
  Panel,
  Skeleton,
  SkeletonPlanCards,
  SkeletonRows,
  Stat,
  TimeAgo,
  TxLink,
} from "@/components/ui";

const meta = {
  title: "UI/Components",
  tags: ["autodocs"],
} satisfies Meta;

type Story = StoryObj<typeof meta>;

export default meta;

export const PanelExample: Story = {
  name: "Panel",
  render: () => (
    <Panel
      title="Monthly revenue"
      subtitle="Recurring payments collected this month"
      actions={<button className="btn-ghost" type="button">View report</button>}
    >
      <p className="text-sm text-muted">Revenue details and recent activity appear here.</p>
    </Panel>
  ),
};

export const StatExample: Story = {
  name: "Stat",
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2">
      <Stat label="Active subscriptions" value={1284} hint="Across all plans" />
      <Stat label="Monthly revenue" value={null} loading hint="Updating totals" />
    </div>
  ),
};

export const BadgeExample: Story = {
  name: "Badge",
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge status="Active" />
      <Badge status="Paused" />
      <Badge status="Cancelled" />
      <Badge status="Completed" />
      <Badge status="Pending" />
    </div>
  ),
};

export const NoticeExample: Story = {
  name: "Notice",
  render: () => (
    <div className="space-y-3">
      <Notice tone="info">Your account is connected to Testnet.</Notice>
      <Notice tone="ok">Payment schedule saved.</Notice>
      <Notice tone="error">The transaction could not be submitted.</Notice>
    </div>
  ),
};

export const ButtonsAndInputs: Story = {
  name: "Buttons and inputs",
  render: () => (
    <div className="max-w-lg space-y-6">
      <div className="flex flex-wrap gap-3">
        <button className="btn-primary" type="button">Save changes</button>
        <button className="btn-ghost" type="button">Cancel</button>
        <button className="btn-danger" type="button">Deactivate</button>
        <button className="btn-primary" type="button" disabled>Unavailable</button>
      </div>
      <div>
        <label className="label" htmlFor="story-plan-name">Plan name</label>
        <input
          className="input"
          id="story-plan-name"
          name="planName"
          placeholder="e.g. Pro monthly"
          type="text"
        />
      </div>
    </div>
  ),
};

export const AddressAndTransactionLinks: Story = {
  render: () => (
    <div className="space-y-3">
      <AddressLink value="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" />
      <TxLink hash="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" />
    </div>
  ),
};

export const MerchantAccountExample: Story = {
  render: () => (
    <MerchantAccount
      value="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      resolvedName="Acme Payments"
    />
  ),
};

export const EmptyState: Story = {
  render: () => (
    <Empty
      title="No plans found"
      action={<button className="btn-ghost" type="button">Reset filters</button>}
    >
      Try changing the search or token filter.
    </Empty>
  ),
};

export const LoadingPlaceholders: Story = {
  render: () => (
    <div className="space-y-6">
      <div>
        <p className="label mb-2">Inline loading</p>
        <Skeleton className="h-6 w-40" />
      </div>
      <SkeletonRows rows={2} label="Loading subscriptions" />
      <SkeletonPlanCards cards={2} label="Loading plans" />
    </div>
  ),
};

export const NetworkMismatch: Story = {
  render: () => (
    <NetworkMismatchBanner
      walletNetwork="Public"
      expectedNetwork="Test SDF Network ; September 2015"
      expectedNetworkLabel="Testnet"
      status="mismatch"
    />
  ),
};

export const TimeAgoEmpty: Story = {
  name: "TimeAgo — missing timestamp",
  render: () => <TimeAgo value={0} />,
};

export const TimeAgoRecent: Story = {
  name: "TimeAgo — recent update",
  render: () => <TimeAgo value={1_736_942_400} />,
};

export const OpenDialog: Story = {
  render: () => (
    <Dialog
      open
      onClose={() => undefined}
      title="Leave this page?"
      actions={
        <>
          <button className="btn-ghost" type="button">Stay</button>
          <button className="btn-danger" type="button">Leave page</button>
        </>
      }
    >
      Your unsaved changes will be lost.
    </Dialog>
  ),
};