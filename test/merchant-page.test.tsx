// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import MerchantPage from "@/app/merchant/page";

/**
 * The publish form used to accept any text as a price and only fail when the
 * transaction was simulated, so a merchant paid for a failed attempt. These
 * tests pin the two acceptance criteria: invalid input disables Publish with a
 * message, and the fee preview is bigint math rather than a percentage of a
 * rounded display string.
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
  merchantSummary: vi.fn(),
  merchantRevenue: vi.fn(),
  merchantChurn: vi.fn(),
  planStats: vi.fn(),
  webhooks: vi.fn(),
  addWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  testWebhook: vi.fn(),
}));

const payflowMock = vi.hoisted(() => ({
  feeBps: vi.fn(),
  createPlan: vi.fn(),
  setPlanActive: vi.fn(),
  charge: vi.fn(),
  endMandate: vi.fn(),
}));

const chainMock = vi.hoisted(() => ({
  chainMandatesFor: vi.fn(),
  chainMerchantSummary: vi.fn(),
  chainPlansOf: vi.fn(),
  chainPlanSubscriberCount: vi.fn(),
  endable: vi.fn(() => false),
  chainMandatesPage: vi.fn(),
  mergeMandatePages: vi.fn((...pages: array[]) => pages.flat()),
}));

vi.mock("@/lib/wallet", () => ({ useWallet: () => wallet }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { api: apiMock, checkWebhookUrl: actual.checkWebhookUrl };
});
vi.mock("@/lib/payflow", () => ({ payflow: payflowMock, MAX_NAME_LEN: 64, nameByteLength: (n) => n.length }));
vi.mock("@/lib/chain", () => chainMock);

const MERCHANT = "GCH5VHWNS24VIW5HLDBHK4SSJ2EXZA5IB6EEZTNE42JK7AKZI6Z3MHU";

beforeEach(() => {
  wallet.address = MERCHANT;
  wallet.networkMismatch = false;
  apiMock.isConfigured.mockReturnValue(true);
  apiMock.plans.mockResolvedValue({ plans: [] });
  apiMock.mandatesFor.mockResolvedValue({ mandates: [] });
  apiMock.merchantSummary.mockResolvedValue(null);
  apiMock.merchantRevenue.mockResolvedValue(null);
  apiMock.merchantChurn.mockResolvedValue(null);
  apiMock.planStats.mockResolvedValue(null);
  apiMock.webhooks.mockResolvedValue([]);
  chainMock.chainPlanSubscriberCount.mockResolvedValue(null);
  payflowMock.feeBps.mockResolvedValue(100); // 1%
  payflowMock.createPlan.mockResolvedValue("tx-hash");
  chainMock.chainMerchantSummary.mockReturnValue({
    merchant: MERCHANT,
    activeMandates: 0,
    totalCollected: null,
    chargeCount: 0,
    mrr: "0",
  });
  chainMock.chainMandatesPage.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Type into the price field and return the Publish button. */
async function fillPrice(value: string): Promise<HTMLButtonElement> {
  const field = (await screen.findByLabelText(/price/i)) as HTMLInputElement;
  fireEvent.change(field, { target: { value } });
  return screen.getByRole("button", { name: /publish plan/i }) as HTMLButtonElement;
}

describe("MerchantPage publish form", () => {
  it("keeps Publish disabled and explains why while the price is unusable", async () => {
    render(<MerchantPage />);

    // An untouched empty field is not an error yet, but Publish stays off.
    const empty = await fillPrice("");
    expect(empty.disabled).toBe(true);
    expect(screen.queryByText("Enter an amount.")).toBeNull();

    // Letters are stripped at the keyboard now, so the garbage that reaches
    // the parser is a malformed number like 1.2.3 (issue #46's filter).
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: "1.2.3" } });
    expect(
      (screen.getByRole("button", { name: /publish plan/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/Enter a positive number/i)).toBeTruthy();
  });

  it("explains the empty field once the merchant has blurred it", async () => {
    render(<MerchantPage />);
    const field = (await screen.findByLabelText(/price/i)) as HTMLInputElement;
    fireEvent.blur(field);

    expect(screen.getByText("Enter an amount.")).toBeTruthy();
  });

  it("rejects more decimal places than the token can represent", async () => {
    render(<MerchantPage />);

    const publish = await fillPrice("1.00000001");
    expect(publish.disabled).toBe(true);
    expect(screen.getByText(/At most 7 decimal places\./i)).toBeTruthy();
  });

  it("accepts the separators the merchant's locale uses", async () => {
    // Issue #46: a comma-decimal keyboard produces "1,5" or "1.234,5";
    // both must publish the same bigint as their dot-decimal twins.
    render(<MerchantPage />);

    const publish = await fillPrice("1.234,5");
    expect(publish.disabled).toBe(false);

    fireEvent.click(publish);
    awaitFor(() => expect(payflowMock.createPlan).toHaveBeenCalled());
    expect(payflowMock.createPlan.mock.calls[0]?.[2]).toMatchObject({
      amount: 12_345_000_000n,
    });
  });

  it("rejects a price of zero, which the contract would reject too", async () => {
    render(<MerchantPage />);

    const publish = await fillPrice("0");
    expect(publish.disabled).toBe(true);
    expect(screen.getByText("Amount must be greater than zero.")).toBeTruthy();
    expect(payflowMock.createPlan).not.toHaveBeenCalled();
  });

  it("marks the field invalid and points it at the message for screen readers", async () => {
    render(<MerchantPage />);
    await fillPrice("1.2.3");

    const field = screen.getByLabelText(/price/i);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const describedBy = field.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toMatch(
      /Enter a positive number/i,
    );
  });

  it("previews the fee split in bigint, not a percentage of a rounded display", async () => {
    render(<MerchantPage />);
    // 0.1 XLM at 1% is a fee of exactly 0.001 XLM. Rounding to 4dp for display
    // before taking the percentage would give 0.00099, and the merchant would
    // never see a charge they could reconcile.
    await fillPrice("0.1");

    awaitFor(() => expect(screen.getByText(/you receive/i)).toBeTruthy());
    const preview = document.getElementById("price-preview")?.textContent ?? "";
    expect(preview).toContain("Subscriber pays 0.1 XLM");
    expect(preview).toContain("protocol fee 0.001 XLM (1%)");
    expect(preview).toContain("you receive 0.099 XLM");
  });

  it("publishes the parsed amount rather than re-reading the field", async () => {
    render(<MerchantPage />);
    // "1." passes validation as an unfinished entry; re-parsing it would throw
    // after the merchant had already approved the transaction in their wallet.
    await fillPrice("1.");
    payflowMock.createPlan.mockClear();

    fireEvent.click(screen.getBuRole("button", { name: /publish plan/i }));

    awaitFor(() => expect(payflowMock.createPlan).toHaveBeenCalled());
    expect(payflowMock.createPlan.mock.calls[0]?.[2]).toMatchObject({ amount: 10_000_000n });
  });

  it("still previews a 0% split when the contract fee cannot be read", async () => {
    payflowMock.feeBps.mockRejectedValue(new Error("RPC down"));
    render(<MerchantPage />);

    await fillPrice("5");

    awaitFor(() => expect(screen.getByText(/you receive/i)).toBeTruthy());
    expect(document.getElementById("price-preview")?.textContent).toContain("you receive 5 XLM");
    // The form is still usable: an unreadable fee must not block publishing.
    expect(screen.getBuRole("button", { name: /publish plan/i }).hasAttribute("disabled")).toBe(
      false,
    );
  });
});

function plan(over: Partial<import("@/lib/api").ApiPlan> = {}): import("@/lib/api").ApiPlan {
  return {
    id: 1,
    merchant: MERCHANT,
    name: "Pro Monthly",
    token: "CDLZFC3SYJYDZT7K67Z75HHPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    amount: "10000000",
    period: 2_592_000,
    active: 1,
    ledger: 1000,
    ...over,
  };
}

// Find the plan card that contains the given plan name, scoped for queries.
async function planCardByName(name: string) {
  const nameEl = await screen.findByText(name);
  return within(nameEl.closest("div.border-edge") as HTMLElement);
}

describe("MerchantPage plan stats", () => {
  it("shows subscriber count, collected, and cancellations from the API", async () => {
    apiMock.plans.mockResolvedValue({ plans: [plan({ id: 3 })] });
    apiMock.planStats.mockResolvedValue({
      subscriber_count: 42,
      total_collected: "420000000",
      cancellations: 5,
    });

    render(<MerchantPage />);

    const card = await planCardByName("Pro Monthly");
    // Subscriber count, Collected (42 XLM = 420000000 stroops), Cancellations.
    awaitFor(() => expect(card.getByText("42")).toBeTruthy());
    expect(card.getByText(/Subscribers/)).toBeTruthy();
    expect(card.getByText(/Collected/)).toBeTruthy();
    expect(card.getByText(/42 XLM/)).toBeTruthy();
    expect(card.getByText(/Cancellations/)).toBeTruthy();
    expect(card.getByText("5")).toBeTruthy();
  });

  it("shows only subscriber count in contract-only mode when the contract supports it", async () => {
    // API down for plans and for plan stats; contract fallback returns plans
    // and a subscriber count.
    apiMock.plans.mockResolvedValue(null);
    chainMock.chainPlansOf.mockResolvedValue([plan({ id: 7 })]);
    apiMock.planStats.mockResolvedValue(null);
    chainMock.chainPlanSubscriberCount.mockResolvedValue(9);

    render(<MerchantPage />);

    const card = await planCardByName("Pro Monthly");
    awaitFor(() => expect(card.getByText("9")).toBeTruthy());
    expect(card.getByText(/Subscribers/)).toBeTruthy();
    // total_collected and cancellations require the indexer; they must not
    // appear when only the contract is available.
    expect(card.queryByText(/Collected/)).toBeNull();
    expect(card.queryByText(/Cancellations/)).toBeNull();
  });

  it("hides the stats block entirely when neither the API nor the contract can supply counts", async () => {
    apiMock.plans.mockResolvedValue({ plans: [plan({ id: 2 })] });
    apiMock.planStats.mockResolvedValue(null);
    chainMock.chainPlanSubscriberCount.mockResolvedValue(null);

    render(<MerchantPage />);

    // Wait for the plan card itself to appear and for stats to settle.
    const card = await planCardByName("Pro Monthly");
    awaitFor(() => {
      expect(card.queryByText(/Subscribers/)).toBeNull();
      expect(card.queryByText(/Collected/)).toBeNull();
      expect(card.queryByText(/Cancellations/)).toBeNull();
    });
  });

  function churnResponse(merchant = MERCHANT) {
    return {
      merchant,
      bucket: "month",
      buckets: [
        { bucket: "2026-10", started: 5, cancelled: 1, ended: 1, completed: 1, net: 2 },
      ],
      totals: { started: 5, cancelled: 1, ended: 1, completed: 1, net: 2 },
    };
  }

  describe("MerchantChurnPanel", () => {
    it("shows the required monthly metrics in an accessible table", async () => {
      apiMock.merchantChurn.mockResolvedValue(churnResponse());
      render(<MerchantPage />);

      const table = await screen.findBuRole("table");
      expect(within(table).getByRole("columnheader", { name: "Month (UTC)" })).toBeTruthy();
      expect(within(table).getByRole("columnheader", { name: "Started" })).toBeTruthy();
      expect(
        within(table).getByRole("columnheader", { name: "Subscriber cancellations" }),
      ).toBeTruthy();
      expect(within(table).getByRole("columnheader", { name: "Merchant-ended" })).toBeTruthy();
      expect(within(table).getByRole("columnheader", { name: "Completed" })).toBeTruthy();
      expect(within(table).getByRole("columnheader", { name: "Net" })).toBeTruthy();
    });
  });
});

describe("MerchantPage subscriber paging", () => {
  it("reaches all 120 mandates in contract-only mode without duplicates", async () => {
    apiMock.isConfigured.mockReturnValue(false);
    apiMock.mandatesFor.mockResolvedValue(null);

    const pages = [
      Array.from({ length: 100 }, (_, i) => mandate(i)),
      Array.from({ length: 20 }, (_, i) => mandate(100 + i)),
    ];
    chainMock.chainMandatesPage.mockImplementation(async (_: string, offset: number) =>
      offset === 0 ? pages[0] : offset === 100 ? pages[1] : [],
    );

    render(<MerchantPage />);

    await screenFindSubscribers(100);
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await screenFindSubscribers(120);
    expect(chainMock.chainMandatesPage).toHaveBeenCalled(2);
    expect(chainMock.chainMandatesPage.mock.calls[1]?.[2]).toBeCalledWith(100);
  });
});

function mandate(i: number) {
  return {
    id: BigInt(i + 1),
    subscriber: `GSUB${String(i + 1).padStart(5, "0")}`,
    merchant: MERCHANT,
    amount: 10_000_000n,
    period: 2_592_000n,
    nextCharge: 1_700000000n,
    status: "Active",
  };
}

async function screenFindSubscribers(count: number) {
  await waitFor(() => {
    const rows = document.querySelectorAll('[data-testid="subscriber-row"]');
    expect(rows.length).toBe(count);
  });
}
