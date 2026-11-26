// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import SubscribePage from "@/app/subscribe/page";
import type { ApiPlan } from "@/lib/api";

/**
 * Keyboard operation of the subscribe flow (#314).
 *
 * The flow is one catalogue of cards: pick Compare, type a charge limit, then
 * Subscribe. Enter from the limit field opens the commitment dialog instead of
 * forcing a tab through the vault controls, Escape returns focus to the field
 * that opened it, and a failed attempt is announced instead of silently
 * appearing above the fold.
 */

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";
const SUBSCRIBER = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";

let search = "";

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

const apiMock = vi.hoisted(() => ({ plans: vi.fn() }));
const chainMock = vi.hoisted(() => ({ chainPlans: vi.fn() }));
const payflowMock = vi.hoisted(() => ({
  subscribe: vi.fn(),
  vaultBalance: vi.fn(),
  feeBps: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
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
vi.mock("@/lib/wallet", () => ({ useWallet: () => wallet }));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chain")>()),
  chainPlans: chainMock.chainPlans,
}));
vi.mock("@/lib/token", () => ({
  metaFor: () => ({ symbol: "XLM", decimals: 7 }),
  useTokenMetas: () => new Map(),
}));
vi.mock("@/lib/toml", () => ({ useOrgName: () => "Acme Payments" }));
vi.mock("@/lib/lazy-payflow", () => ({ payflow: payflowMock }));

function plan(overrides: Partial<ApiPlan> = {}): ApiPlan {
  return {
    id: 1,
    merchant: MERCHANT,
    name: "Pro Monthly",
    token: "",
    amount: "10000000",
    period: 2_592_000,
    active: 1,
    ledger: 0,
    ...overrides,
  };
}

async function firstCard() {
  const heading = await screen.findByRole("heading", { level: 2, name: "Pro Monthly" });
  return heading.closest("section") as HTMLElement;
}

beforeEach(() => {
  search = "";
  wallet.address = null;
  wallet.networkMismatch = false;
  apiMock.plans.mockReset();
  chainMock.chainPlans.mockReset();
  payflowMock.subscribe.mockReset();
  payflowMock.vaultBalance.mockReset();
  payflowMock.vaultBalance.mockResolvedValue(0n);
  payflowMock.feeBps.mockReset();
  payflowMock.feeBps.mockResolvedValue(0);

  apiMock.plans.mockResolvedValue({
    plans: [plan(), plan({ id: 2, name: "Yearly" })],
  });
});

afterEach(cleanup);

describe("subscribe flow by keyboard", () => {
  it("orders each card's controls compare → limit → subscribe", async () => {
    wallet.address = SUBSCRIBER;
    render(<SubscribePage />);

    const card = await firstCard();
    const checkbox = within(card).getByRole("checkbox", { name: /compare pro monthly/i });
    const limit = within(card).getByLabelText(/charge limit/i);
    const subscribe = within(card).getByRole("button", { name: /^subscribe$/i });

    // Document order is tab order for these enabled controls. The card header
    // comes first, then the limit field, then the committing button.
    const controls = Array.from(
      card.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), a[href]',
      ),
    );
    expect(controls.indexOf(checkbox)).toBeGreaterThanOrEqual(0);
    expect(controls.indexOf(checkbox)).toBeLessThan(controls.indexOf(limit));
    expect(controls.indexOf(limit)).toBeLessThan(controls.indexOf(subscribe));

    // Nothing in the flow removes keyboard focus from a native control.
    for (const control of controls) {
      expect(control.getAttribute("tabindex")).not.toBe("-1");
    }
  });

  it("opens the confirmation from Enter in the charge-limit field", async () => {
    wallet.address = SUBSCRIBER;
    render(<SubscribePage />);

    const limit = within(await firstCard()).getByLabelText(/charge limit/i);
    limit.focus();
    fireEvent.keyDown(limit, { key: "Enter" });

    const dialog = await screen.findByRole("dialog", {
      name: /subscribe to pro monthly\?/i,
    });
    // Focus moves into the dialog, so a keyboard user hears the commitment
    // before reaching Cancel / Confirm.
    await waitFor(() => expect(document.activeElement).toBe(dialog));

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Escape hands focus back to the field that opened the dialog.
    expect(document.activeElement).toBe(limit);
  });

  it("announces a failed attempt to a keyboard user", async () => {
    wallet.address = SUBSCRIBER;
    render(<SubscribePage />);

    // A negative cap fails local validation when Enter submits the field. The
    // failure must be a live region, not text a screen reader only finds by
    // navigating back up the page.
    const limit = within(await firstCard()).getByLabelText(/charge limit/i);
    fireEvent.change(limit, { target: { value: "-1" } });
    fireEvent.keyDown(limit, { key: "Enter" });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/whole number/i);
  });

  it("keeps the comparison table reachable and labelled", async () => {
    wallet.address = SUBSCRIBER;
    render(<SubscribePage />);

    const card = await firstCard();
    fireEvent.click(within(card).getByRole("checkbox", { name: /compare pro monthly/i }));
    const yearlyHeading = await screen.findByRole("heading", { level: 2, name: "Yearly" });
    fireEvent.click(
      within(yearlyHeading.closest("section") as HTMLElement).getByRole("checkbox", {
        name: /compare yearly/i,
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /compare plans/i }));
    const table = await screen.findByRole("table", { name: /side-by-side comparison/i });
    expect(table).toBeTruthy();
    expect(
      screen.getAllByRole("region", { name: /plan comparison/i }).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
