// @vitest-environment jsdom
import { useState } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AmountInput } from "@/components/AmountInput";
import { DepositCoverageInput } from "@/components/DepositCoverageInput";
import { Search } from "@/components/Search";
import { LanguagePicker } from "@/i18n/LanguagePicker";
import { PlanPageClient } from "@/app/plans/[id]/PlanPageClient";
import MerchantPublicPage from "@/app/m/page";
import SubscribePage from "@/app/subscribe/page";
import { SubscribeCardFlow } from "@/app/subscribe/SubscribeCardFlow";
import AccountPage from "@/app/account/page";
import MerchantPage from "@/app/merchant/page";
import type { ApiMandate, ApiPlan } from "@/lib/api";

const MERCHANT = Keypair.random().publicKey();
const SUBSCRIBER = "subscriber.testnet";
const TOKEN = "token.testnet";

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  wallet: {
    address: "subscriber.testnet" as string | null,
    connecting: false,
    error: null as string | null,
    networkMismatch: false,
    walletNetwork: null as string | null,
    account: { state: "loading" } as
      | { state: "loading" }
      | { state: "loaded"; account: { balance: bigint; subentryCount: number } },
    funding: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    refreshAccount: vi.fn(),
    fund: vi.fn(),
    signXdr: vi.fn(),
  },
  api: {
    isConfigured: vi.fn(() => true),
    plans: vi.fn(),
    mandatesOf: vi.fn(),
    mandatesFor: vi.fn(),
    vaultHistory: vi.fn(),
    charges: vi.fn(),
    merchantSummary: vi.fn(),
    merchantRevenue: vi.fn(),
    merchantChurn: vi.fn(),
    merchantCohortRetention: vi.fn(),
    planStats: vi.fn(),
    stream: vi.fn(),
    webhooks: vi.fn(),
  },
  payflow: {
    feeBps: vi.fn(),
    subscribe: vi.fn(),
    vaultBalance: vi.fn(),
    getPlan: vi.fn(),
    getMandate: vi.fn(),
    supportsPlanRename: vi.fn(),
    createPlan: vi.fn(),
    setPlanActive: vi.fn(),
    setMaxCharges: vi.fn(),
    pauseUntil: vi.fn(),
    refund: vi.fn(),
  },
  helpers: {
    mandatePauseUntil: vi.fn(),
    mandateIsPastDue: vi.fn(() => false),
    mandatePastDueUntil: vi.fn(() => null),
    vaultSupportsDepositFor: vi.fn(),
    validateRecipient: vi.fn(() => null),
    mandateSupportsSpendLimit: vi.fn(() => false),
    mandateSupportsRefund: vi.fn(() => false),
    mandateRefundableAmount: vi.fn(() => null as bigint | null),
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: unknown }) => (
    <a href={typeof href === "string" ? href : ""} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/wallet", () => ({ useWallet: () => mocks.wallet }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { api: mocks.api, checkWebhookUrl: actual.checkWebhookUrl };
});
vi.mock("@/lib/payflow-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payflow-core")>()),
  MAX_NAME_LEN: 64,
  nameByteLength: (n: string) => n.length,
  mandatePendingTransfer: () => null,
  mandateStatus: (raw: unknown) =>
    Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? ""),
  ...mocks.helpers,
}));
vi.mock("@/lib/payflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payflow")>()),
  checkTrustline: async () => true,
  mandateSupportsTransfer: () => false,
  mandatePendingTransfer: () => null,
  MAX_NAME_LEN: 64,
  nameByteLength: (n: string) => n.length,
  payflow: mocks.payflow,
  ...mocks.helpers,
}));
vi.mock("@/lib/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chain")>()),
  chainMandatesOf: vi.fn(async () => []),
  chainMandatesFor: vi.fn(async () => []),
  chainPlans: vi.fn(async () => []),
  chainPlansOf: vi.fn(async () => []),
  chainPlanSubscriberCount: vi.fn(async () => null),
  chainMerchantSummary: vi.fn(() => ({
    merchant: "merchant.testnet",
    activeMandates: 0,
    totalCollected: null,
    chargeCount: 0,
    mrr: "0",
  })),
  endable: vi.fn(() => true),
  mandateFunding: vi.fn(() => ({ status: "funded", shortfall: 0n })),
}));
vi.mock("@/lib/token", () => ({
  metaFor: () => ({ symbol: "XLM", decimals: 7 }),
  useTokenMetas: () => new Map(),
  clearTokenMetaCache: () => {},
}));
vi.mock("@/lib/toml", () => ({ useOrgName: () => "Acme" }));
vi.mock("@/lib/config", () => ({
  config: {
    rpcUrl: "http://localhost:8000/rpc",
    rpcUrls: ["http://localhost:8000/rpc"],
    horizonUrl: "http://localhost:8081",
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "TESTNET",
    apiUrl: "http://localhost:8080",
    basePath: "",
    readSource: "subscriber.testnet",
    contracts: {
      planRegistry: "plan-registry.testnet",
      vault: "vault.testnet",
      subscription: "subscription.testnet",
      token: "token.testnet",
    },
  },
  explorerBase: "https://stellar.expert/explorer/testnet",
  requireContracts: () => {},
}));

function samplePlan(overrides: Partial<ApiPlan> = {}): ApiPlan {
  return {
    id: 1,
    merchant: MERCHANT,
    name: "Pro Monthly",
    token: TOKEN,
    amount: "10000000",
    period: 2_592_000,
    active: 1,
    ledger: 0,
    ...overrides,
  };
}

function sampleMandate(overrides: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 7,
    subscriber: SUBSCRIBER,
    merchant: MERCHANT,
    plan_id: 1,
    amount: "10000000",
    period: 2_592_000,
    next_charge: Math.floor(Date.now() / 1000) + 86_400,
    last_charge: 0,
    charges_made: 1,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
    token: TOKEN,
    ended_by: null,
    ...overrides,
  };
}

function assertLinkedError(input: HTMLElement, expectedText: RegExp | string) {
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const describedBy = input.getAttribute("aria-describedby") ?? "";
  expect(describedBy.trim().length).toBeGreaterThan(0);
  const errorTexts = describedBy
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
  if (typeof expectedText === "string") {
    expect(errorTexts).toContain(expectedText);
  } else {
    expect(errorTexts).toMatch(expectedText);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchParams = new URLSearchParams();
  mocks.wallet.address = SUBSCRIBER;
  mocks.wallet.networkMismatch = false;
  mocks.api.isConfigured.mockReturnValue(true);
  mocks.api.plans.mockResolvedValue({ plans: [samplePlan()] });
  mocks.api.mandatesOf.mockResolvedValue({ mandates: [sampleMandate()] });
  mocks.api.mandatesFor.mockResolvedValue({ mandates: [] });
  mocks.api.vaultHistory.mockResolvedValue({ events: [] });
  mocks.api.charges.mockResolvedValue({ charges: [] });
  mocks.api.merchantSummary.mockResolvedValue(null);
  mocks.api.merchantRevenue.mockResolvedValue(null);
  mocks.api.merchantChurn.mockResolvedValue(null);
  mocks.api.merchantCohortRetention.mockResolvedValue(null);
  mocks.api.planStats.mockResolvedValue(null);
  mocks.api.webhooks.mockResolvedValue([]);
  mocks.payflow.feeBps.mockResolvedValue(100);
  mocks.payflow.vaultBalance.mockResolvedValue(50_000_000n);
  mocks.payflow.supportsPlanRename.mockResolvedValue(false);
  mocks.payflow.getMandate.mockResolvedValue({
    id: 7,
    subscriber: SUBSCRIBER,
    merchant: MERCHANT,
    plan_id: 1,
    token: "",
    amount: 10_000_000n,
    period: 2_592_000n,
    next_charge: 0n,
    last_charge: 0n,
    charges_made: 1,
    max_charges: 0,
    fee_bps: 100,
    status: ["Active"],
  });
  mocks.helpers.mandatePauseUntil.mockReturnValue(null);
  mocks.helpers.vaultSupportsDepositFor.mockResolvedValue(false);
  mocks.helpers.mandateSupportsRefund.mockReturnValue(false);
  mocks.helpers.mandateRefundableAmount.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
});

describe("Form controls accessibility (#316)", () => {
  it("associates labels and alert errors in AmountInput, DepositCoverageInput, Search, and LanguagePicker", () => {
    function AmountHarness() {
      const [val, setVal] = useState("");
      return (
        <AmountInput
          id="amt"
          label="Deposit amount"
          value={val}
          onChange={setVal}
          decimals={7}
          invalid={val === ""}
          describedBy="amt-external"
        />
      );
    }

    render(
      <>
        <AmountHarness />
        <p id="amt-external">External message</p>
        <DepositCoverageInput planAmount={10_000_000n} decimals={7} symbol="XLM" onDeposit={vi.fn()} />
        <Search value="" onChange={vi.fn()} label="Filter plans" />
        <LanguagePicker />
      </>,
    );

    const amt = screen.getByLabelText("Deposit amount");
    expect(amt.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(amt, { target: { value: "1.2.3" } });
    assertLinkedError(amt, /Enter a positive number/);

    const periods = screen.getByLabelText("Periods");
    const covAmount = screen.getByLabelText("Amount (XLM)");
    fireEvent.change(periods, { target: { value: "1.5" } });
    assertLinkedError(periods, /whole number of periods/i);
    assertLinkedError(covAmount, /whole number of periods/i);

    expect(screen.getByLabelText("Filter plans")).toBeTruthy();
    expect(screen.getByLabelText("Language")).toBeTruthy();
  });

  it("exposes charge limit errors on PlanPageClient and avoids orphan <label> elements", async () => {
    const { container } = render(<PlanPageClient planId="1" />);
    const input = await screen.findByLabelText("Charge limit (0 = open-ended)");

    // Non-input metadata headings must not be unassociated <label> elements.
    const orphanLabels = Array.from(container.querySelectorAll("label")).filter((el) => {
      const htmlFor = el.getAttribute("for");
      return !htmlFor && !el.querySelector("input, select, textarea");
    });
    expect(orphanLabels).toEqual([]);

    fireEvent.change(input, { target: { value: "2.5" } });
    assertLinkedError(input, /Charge limit must be a whole number/);

    const subscribe = screen.getByRole("button", { name: "Subscribe" });
    fireEvent.click(subscribe);
    expect(document.activeElement).toBe(input);
    expect(mocks.payflow.subscribe).not.toHaveBeenCalled();
  });

  it("associates charge limit label and validation error on /m public page", async () => {
    mocks.searchParams = new URLSearchParams(`address=${MERCHANT}`);
    render(<MerchantPublicPage />);

    const input = await screen.findByLabelText("Charge limit (0 = open-ended)");
    fireEvent.change(input, { target: { value: "1.5" } });
    assertLinkedError(input, /Charge limit must be a whole number/);

    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(document.activeElement).toBe(input);
    expect(mocks.payflow.subscribe).not.toHaveBeenCalled();
  });

  it("associates charge limit label and validation error on /subscribe and SubscribeCardFlow", async () => {
    render(<SubscribePage />);
    const limitInput = await screen.findByLabelText("Charge limit (0 = open-ended)");
    expect(screen.getByLabelText("Compare Pro Monthly")).toBeTruthy();

    fireEvent.change(limitInput, { target: { value: "3.5" } });
    assertLinkedError(limitInput, /Charge limit must be a whole number/);

    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(limitInput);

    cleanup();

    render(<SubscribeCardFlow plan={samplePlan()} metas={new Map()} now={Math.floor(Date.now() / 1000)} />);
    const cardInput = await screen.findByLabelText("Max charges (0 for open-ended)");
    fireEvent.change(cardInput, { target: { value: "2.5" } });
    assertLinkedError(cardInput, /Charge limit must be a whole number/);
  });

  it("links validation errors to inputs on AccountPage (withdraw, cap editor, pause-until)", async () => {
    mocks.helpers.mandatePauseUntil.mockReturnValue(Math.floor(Date.now() / 1000) + 86_400);
    render(<AccountPage />);

    const amountInput = await screen.findByLabelText("Amount (XLM)");
    await screen.findByText("5 XLM");
    fireEvent.change(amountInput, { target: { value: "10" } });
    assertLinkedError(amountInput, /Amount is more than your vault balance/);

    // Edit cap invalid input links error via aria-invalid and aria-describedby.
    fireEvent.click(screen.getByRole("button", { name: "Edit cap" }));
    const capInput = screen.getByLabelText("Max charges (0 = unlimited)");
    fireEvent.change(capInput, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save cap" }));
    assertLinkedError(capInput, /Cap cannot be below/);

    // Pause-until invalid date links error via aria-invalid and aria-describedby.
    fireEvent.click(screen.getByRole("button", { name: "Pause until…" }));
    const dateInput = screen.getByLabelText(/Resume date for mandate 7/);
    fireEvent.change(dateInput, { target: { value: "2020-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Pause until…" }));
    assertLinkedError(dateInput, /Pick a date in the future/);
  });

  it("links refund overflow error and touched-empty price error on MerchantPage", async () => {
    mocks.wallet.address = MERCHANT;
    mocks.api.mandatesFor.mockResolvedValue({ mandates: [sampleMandate()] });
    mocks.helpers.mandateSupportsRefund.mockReturnValue(true);
    mocks.helpers.mandateRefundableAmount.mockReturnValue(5_000_000n); // 0.5 XLM max

    render(<MerchantPage />);

    // Blurring an empty price marks the field invalid and points at #price-preview.
    const priceInput = await screen.findByLabelText(/price/i);
    fireEvent.blur(priceInput);
    assertLinkedError(priceInput, /Enter an amount\./);

    // Refund amount above maxRefund must link #refund-amount-error via aria-describedby.
    const refundBtn = await screen.findByRole("button", { name: "Refund" });
    fireEvent.click(refundBtn);
    const refundInput = screen.getByLabelText(/Amount \(XLM\)/);
    fireEvent.change(refundInput, { target: { value: "1" } });
    assertLinkedError(refundInput, /Refund cannot exceed/);
  });
});
