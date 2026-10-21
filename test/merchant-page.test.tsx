// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  charge: vi.fn(),
  endMandate: vi.fn(),
}));

const chainMock = vi.hoisted(() => ({
  chainMandatesFor: vi.fn(),
  chainMerchantSummary: vi.fn(),
  chainPlansOf: vi.fn(),
  chainPlanSubscriberCount: vi.fn(),
  endable: vi.fn(() => false),
}));

vi.mock("@/lib/wallet", () => ({ useWallet: () => wallet }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { api: apiMock, checkWebhookUrl: actual.checkWebhookUrl };
});
vi.mock("@/lib/payflow", () => ({ payflow: payflowMock, MAX_NAME_LEN: 64, nameByteLength: (n: string) => n.length }));
vi.mock("@/lib/chain", () => chainMock);

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";

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

/** Switch the billing-period picker to Custom and set the count (and unit). */
async function chooseCustom(count: string, unit = "day"): Promise<void> {
  fireEvent.change(await screen.findByLabelText(/billing period/i), {
    target: { value: "custom" },
  });
  fireEvent.change(screen.getByLabelText(/custom period/i), { target: { value: count } });
  if (unit !== "day") {
    fireEvent.change(screen.getByLabelText(/^unit$/i), { target: { value: unit } });
  }
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
    await waitFor(() => expect(payflowMock.createPlan).toHaveBeenCalled());
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

    await waitFor(() =>
      expect(screen.getByText(/you receive/)).toBeTruthy(),
    );
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

    fireEvent.click(screen.getByRole("button", { name: /publish plan/i }));

    await waitFor(() => expect(payflowMock.createPlan).toHaveBeenCalled());
    expect(payflowMock.createPlan.mock.calls[0]?.[2]).toMatchObject({ amount: 10_000_000n });
  });

  it("still previews a 0% split when the contract fee cannot be read", async () => {
    payflowMock.feeBps.mockRejectedValue(new Error("RPC down"));
    render(<MerchantPage />);

    await fillPrice("5");

    await waitFor(() => expect(screen.getByText(/you receive/)).toBeTruthy());
    expect(document.getElementById("price-preview")?.textContent).toContain("you receive 5 XLM");
    // The form is still usable: an unreadable fee must not block publishing.
    expect(screen.getByRole("button", { name: /publish plan/i }).hasAttribute("disabled")).toBe(
      false,
    );
  });
});

/**
 * Issue #29: five fixed periods meant a merchant billing fortnightly or
 * quarterly could not use Payflow. The picker keeps those five and adds
 * Custom; these tests pin the conversion to whole seconds and the acceptance
 * criterion — a below-minimum period is rejected in the form, with the
 * contract's wording, so the wallet never opens for a doomed publish.
 */
describe("MerchantPage period picker", () => {
  it("offers the original five presets plus Custom, opening on monthly", async () => {
    render(<MerchantPage />);

    const select = (await screen.findByLabelText(/billing period/i)) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Every minute (demo)",
      "Daily",
      "Weekly",
      "Monthly",
      "Yearly",
      "Custom…",
    ]);
    expect(select.value).toBe("2592000");
    // Nothing custom is on screen until it is asked for.
    expect(screen.queryByLabelText(/custom period/i)).toBeNull();
  });

  it("publishes a fortnightly period once Custom is chosen", async () => {
    render(<MerchantPage />);

    const publish = await fillPrice("1");
    await chooseCustom("2", "week");

    expect(publish.disabled).toBe(false);
    fireEvent.click(publish);

    await waitFor(() => expect(payflowMock.createPlan).toHaveBeenCalled());
    expect(payflowMock.createPlan.mock.calls[0]?.[2]).toMatchObject({ period: 1_209_600 });
  });

  it("publishes a quarterly period counted in months", async () => {
    render(<MerchantPage />);

    const publish = await fillPrice("1");
    await chooseCustom("3", "month");

    expect(publish.disabled).toBe(false);
    fireEvent.click(publish);

    await waitFor(() => expect(payflowMock.createPlan).toHaveBeenCalled());
    expect(payflowMock.createPlan.mock.calls[0]?.[2]).toMatchObject({ period: 7_776_000 });
  });

  it("still publishes the monthly default when Custom is never chosen", async () => {
    render(<MerchantPage />);

    const publish = await fillPrice("1");
    fireEvent.click(publish);

    await waitFor(() => expect(payflowMock.createPlan).toHaveBeenCalled());
    expect(payflowMock.createPlan.mock.calls[0]?.[2]).toMatchObject({ period: 2_592_000 });
  });

  it("rejects a below-minimum custom period with the contract's own words", async () => {
    render(<MerchantPage />);

    const publish = await fillPrice("1");
    await chooseCustom("0");

    expect(publish.disabled).toBe(true);
    expect(screen.getByText("Billing period must be at least 60 seconds.")).toBeTruthy();
    // Disabled buttons swallow clicks, so this stays an unsubmitted form even
    // if something re-dispatches one.
    fireEvent.click(publish);
    expect(payflowMock.createPlan).not.toHaveBeenCalled();
  });

  it("keeps Publish off for an empty custom count and says what is missing", async () => {
    render(<MerchantPage />);

    const publish = await fillPrice("1");
    await chooseCustom("");

    // Choosing Custom is itself the request for a period, so the form names
    // the gap at once rather than waiting to be told — but nothing below the
    // 60-second floor (an uncomputed period included) can be published.
    expect(publish.disabled).toBe(true);
    expect(screen.getByText("Enter a whole number of days.")).toBeTruthy();
  });

  it("points a bad custom count at its message for screen readers", async () => {
    render(<MerchantPage />);
    await fillPrice("1");
    await chooseCustom("0");

    const field = screen.getByLabelText(/custom period/i);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const describedBy = field.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      "Billing period must be at least 60 seconds.",
    );
  });

  it("rejects a fractional count and names the unit in the message", async () => {
    render(<MerchantPage />);

    const publish = await fillPrice("1");
    await chooseCustom("2.5");

    expect(publish.disabled).toBe(true);
    expect(screen.getByText("Enter a whole number of days.")).toBeTruthy();

    // Changing the unit re-labels the complaint: the count is still unusable,
    // and the message still names the unit now selected.
    fireEvent.change(screen.getByLabelText(/^unit$/i), { target: { value: "week" } });
    expect(screen.getByText("Enter a whole number of weeks.")).toBeTruthy();
  });

  it("lets the merchant change their mind back to a preset", async () => {
    render(<MerchantPage />);

    const publish = await fillPrice("1");
    await chooseCustom("0");
    expect(publish.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/billing period/i), { target: { value: "604800" } });
    expect(screen.queryByLabelText(/custom period/i)).toBeNull();
    expect(publish.disabled).toBe(false);

    fireEvent.click(publish);
    await waitFor(() => expect(payflowMock.createPlan).toHaveBeenCalled());
    expect(payflowMock.createPlan.mock.calls[0]?.[2]).toMatchObject({ period: 604_800 });
  });
});
