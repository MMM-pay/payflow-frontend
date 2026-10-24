import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge, Notice, Panel, Stat } from "@/components/ui";

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
  render: () => <Stat label="Active subscriptions" value={1284} hint="Across all plans" />,
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