// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanPageClient } from "@/app/plans/[id]/PlanPageClient";
import type { ApiCharge, ApiMandate, ApiPlan } from "@/lib/api";

const apiMock = vi.hoisted(() => ({
  plans: vi.fn(),
  mandatesFor: vi.fn(),
  charges: vi.fn(),
}));

const chainMock = vi.hoisted(() => ({
  chainPlans: vi.fn(),
  chainMandatesFor: vi.fn(),
}));

const walletMock = vi.hoisted(() => ({
  address: "wallet-a",
  networkMismatch: false,
  signXdr: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chain")>()),
  ...chainMock,
}));
vi.mock("@/lib/lazy-payflow", () => ({
  payflow: { subscribe: vi.fn() },
  server: {},
}));
vi.mock("@/lib/wallet", () => ({ useWallet: () => walletMock }));
vi.mock("@/lib/token", () => ({
  useTokenMetas: () => new Map(),
  metaFor: () => ({ symbol: "XLM", decimals: 7 }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const plan: ApiPlan = {
  id: 1,
  merchant: "merchant",
  name: "Cohort",
  token: "token",
  amount: "10000000",
  period: 86_400,
  active: 1,
  ledger: 0,
};

const mandate: ApiMandate = {
  id: 1,
  subscriber: "subscriber",
  merchant: "merchant",
  plan_id: 1,
  amount: "10000000",
  period: 86_400,
  next_charge: 0,
  last_charge: 0,
  charges_made: 0,
  max_charges: 0,
  fee_bps: 100,
  status: "Active",
  token: "token",
};

describe("PlanPageClient recent charges table", () => {
  it("right-aligns and monospaces monetary columns, leaving others untouched", async () => {
    apiMock.plans.mockResolvedValue({ plans: [plan] });
    apiMock.mandatesFor.mockResolvedValue({ mandates: [mandate] });
    apiMock.charges.mockResolvedValue({
      charges: [
        {
          mandate_id: 1,
          amount: "20000000",
          fee: "100000",
          charges_made: 1,
          ledger: 12345,
          tx_hash: "abcd1234",
        } as ApiCharge,
      ],
    });

    render(<PlanPageClient planId="1" />);

    await waitFor(() => expect(screen.getByText("2 XLM")).toBeTruthy());

    const amountCell = screen.getByText("2 XLM").closest("td");
    const feeCell = screen.getByText("0.01 XLM").closest("td");
    const netCell = screen.getByText("1.99 XLM").closest("td");

    for (const cell of [amountCell, feeCell, netCell].filter(Boolean) as HTMLElement[]) {
      expect(cell.className).toContain("text-right");
      expect(cell.className).toContain("font-mono");
      expect(cell.className).toContain("tabular-nums");
    }

    expect(screen.getByText("Amount").closest("th")?.className).toContain("text-right");
    expect(screen.getByText("Fee").closest("th")?.className).toContain("text-right");
    expect(screen.getByText("Net").closest("th")?.className).toContain("text-right");

    // Non-monetary columns are not monospaced.
    const mandateCell = screen.getByText("1").closest("td");
    expect(mandateCell?.className).not.toContain("font-mono");
  });
});
