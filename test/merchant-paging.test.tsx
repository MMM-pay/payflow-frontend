// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MerchantPage from "@/app/merchant/page";
import type { ApiMandate } from "@/lib/api";

/**
 * Issue #27: with no backend, the merchant dashboard reads mandates from the
 * contract index. This pins the UI half — the status line, the button, and
 * that a shifted window cannot duplicate a row — on a small list so it stays
 * fast. The 120-mandate arithmetic is covered by test/mandate-paging.test.ts.
 */

const wallet = vi.hoisted(() => ({
  address: null as string | null,
  connecting: false,
  error: null as string | null,
  networkMismatch: false,
  walletNetwork: null as string | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  signXdr: vi.fn(),
}));

const apiMock = vi.hoisted(() => ({
  isConfigured: vi.fn(() => true),
  plans: vi.fn(),
  mandatesFor: vi.fn(),
  unpaidMandates: vi.fn(),
  merchantSummary: vi.fn(),
  merchantRevenue: vi.fn(),
  merchantChurn: vi.fn(),
  merchantCohortRetention: vi.fn(),
  planStats: vi.fn(),
  stream: vi.fn(),
  webhooks: vi.fn(),
  addWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  testWebhook: vi.fn(),
}));

const payflowMock = vi.hoisted(() => ({
  feeBps: vi.fn(),
  createPlan: vi.fn(),
  setPlanActive: vi.fn(),
  supportsPlanRename: vi.fn().mockResolvedValue(false),
  charge: vi.fn(),
  endMandate: vi.fn(),
  merchantPlanCount: vi.fn(),
  deactivatePage: vi.fn(),
  vaultBalance: vi.fn(),
  getMandate: vi.fn(),
  getProfile: vi.fn().mockResolvedValue(null),
}));

const chainMock = vi.hoisted(() => ({
  chainMerchantMandatesPage: vi.fn(),
  chainPlansOf: vi.fn(async () => []),
  chainPlanSubscriberCount: vi.fn(async () => null),
  chainUnpaidMandates: vi.fn(async () => []),
}));

vi.mock("@/lib/wallet", () => ({ useWallet: () => wallet }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { api: apiMock, checkWebhookUrl: actual.checkWebhookUrl };
});
vi.mock("@/lib/payflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payflow")>();
  return {
    payflow: payflowMock,
    MAX_NAME_LEN: 64,
    MAX_PAGE: actual.MAX_PAGE,
    nameByteLength: (n: string) => n.length,
    mandateSupportsRefund: actual.mandateSupportsRefund,
    mandateRefundableAmount: actual.mandateRefundableAmount,
    mandatePauseUntil: actual.mandatePauseUntil,
  };
});
vi.mock("@/lib/end-mandates", () => ({ endMandates: vi.fn() }));
vi.mock("@/lib/chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chain")>();
  return {
    ...actual,
    chainMerchantMandatesPage: chainMock.chainMerchantMandatesPage,
    chainPlansOf: chainMock.chainPlansOf,
    chainPlanSubscriberCount: chainMock.chainPlanSubscriberCount,
    chainUnpaidMandates: chainMock.chainUnpaidMandates,
    // Keep the selection toolbar out of this test; paging is what it pins.
    endable: () => false,
  };
});

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";
const SUBSCRIBER = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";
const TOTAL = 3;
const PAGE = 2;

function apiMandate(id: number): ApiMandate {
  return {
    id,
    subscriber: SUBSCRIBER,
    merchant: MERCHANT,
    plan_id: 1,
    amount: "10000000",
    period: 2_592_000,
    next_charge: 0,
    last_charge: 0,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
    // Present, so the dashboard does not probe the contract for support.
    discount_bps: 0,
    refundable_amount: "0",
  };
}

const all = Array.from({ length: TOTAL }, (_, i) => apiMandate(i + 1));

beforeEach(() => {
  wallet.address = MERCHANT;
  wallet.networkMismatch = false;
  apiMock.isConfigured.mockReturnValue(true);
  apiMock.plans.mockResolvedValue({ plans: [] });
  // No backend mandates: this pins the contract-only path.
  apiMock.mandatesFor.mockResolvedValue(null);
  apiMock.unpaidMandates.mockResolvedValue(null);
  apiMock.merchantSummary.mockResolvedValue(null);
  apiMock.merchantRevenue.mockResolvedValue(null);
  apiMock.merchantChurn.mockResolvedValue(null);
  apiMock.merchantCohortRetention.mockResolvedValue(null);
  apiMock.planStats.mockResolvedValue(null);
  apiMock.webhooks.mockResolvedValue([]);
  payflowMock.feeBps.mockResolvedValue(100);
  payflowMock.vaultBalance.mockResolvedValue(10_000_000n);

  // Mirror the contract index: oldest first, newest-first page returned.
  chainMock.chainMerchantMandatesPage.mockImplementation(
    async (_source: string, _merchant: string, offset = 0) => {
      // The page always asks for MAX_PAGE rows; serve PAGE of them to force
      // a second "Load more" click without rendering a hundred rows.
      const end = Math.max(0, TOTAL - offset);
      const start = Math.max(0, end - PAGE);
      return {
        rows: all.slice(start, end).reverse(),
        total: TOTAL,
      };
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MerchantPage subscriber paging", () => {
  it("appends every page and stops with the list fully loaded", async () => {
    render(<MerchantPage />);

    expect(await screen.findByText("Showing 2 of 3 subscribers.")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /load more subscribers/i }));
    expect(
      await screen.findByText("Showing 3 of 3 subscribers. All subscribers loaded."),
    ).toBeTruthy();

    expect(screen.queryByRole("button", { name: /load more subscribers/i })).toBeNull();

    const ids = screen.getAllByRole("article").map((node) => node.textContent);
    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
  });

  it("does not duplicate a row that the index returns in two pages", async () => {
    // A subscription opened between page loads shifts every offset by one, so
    // the second page repeats a row the first page already showed.
    chainMock.chainMerchantMandatesPage
      .mockResolvedValueOnce({ rows: [all[2]!, all[1]!], total: TOTAL })
      .mockResolvedValueOnce({ rows: [all[1]!, all[0]!], total: TOTAL });

    render(<MerchantPage />);
    expect(await screen.findByText("Showing 2 of 3 subscribers.")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /load more subscribers/i }));
    expect(
      await screen.findByText("Showing 3 of 3 subscribers. All subscribers loaded."),
    ).toBeTruthy();

    const ids = screen.getAllByRole("article").map((node) => node.textContent);
    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
  });
});
