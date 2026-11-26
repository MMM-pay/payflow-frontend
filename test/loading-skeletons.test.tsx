// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  Skeleton,
  SkeletonPlanCards,
  SkeletonPlanDetail,
  SkeletonRows,
} from "@/components/ui";
import SubscribePage from "@/app/subscribe/page";
import MerchantPublicPage from "@/app/m/page";
import { PlanPageClient } from "@/app/plans/[id]/PlanPageClient";
import type { ApiPlan } from "@/lib/api";

/**
 * Loading states for the primary views (#304, #340).
 *
 * The point of a skeleton is that it is announced as busy, contains no text a
 * screen reader would read as empty data, and covers the same blocks as the
 * loaded page. These tests pin the accessible contract and the "still loading"
 * state of the three plan views.
 */

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";

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
const chainMock = vi.hoisted(() => ({
  chainPlans: vi.fn(),
  chainPlansOf: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  notFound: vi.fn(),
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
  chainPlansOf: chainMock.chainPlansOf,
}));
vi.mock("@/lib/config", () => ({
  config: {
    readSource: "GAKOHW5FUKSF3SXQQWLD647RQJPOR5RZOS4ITSMWC5NPC67DEXXYU43H",
    contracts: { token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" },
  },
  explorerBase: "https://stellar.expert/explorer/testnet",
}));
vi.mock("@/lib/token", () => ({
  metaFor: () => ({ symbol: "XLM", decimals: 7 }),
  useTokenMetas: () => new Map(),
}));
vi.mock("@/lib/toml", () => ({ useOrgName: () => "Acme Payments" }));
vi.mock("@/lib/lazy-payflow", () => ({ payflow: {} }));

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

afterEach(() => {
  cleanup();
  search = "";
  apiMock.plans.mockReset();
});

describe("skeleton primitives", () => {
  it("announce themselves as busy without exposing decorative blocks", () => {
    const { container } = render(<SkeletonRows rows={2} label="Loading history" />);

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toContain("Loading history");
    // Every visual block is decorative, so a screen reader hears the status
    // sentence once instead of a run of empty elements.
    for (const block of container.querySelectorAll("span.block")) {
      expect(block.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("drops the pulse for users who ask for reduced motion", () => {
    const { container } = render(<Skeleton className="h-4 w-10" />);
    const block = container.firstElementChild;
    expect(block?.className).toContain("motion-safe:animate-pulse");
    expect(block?.getAttribute("aria-hidden")).toBe("true");
  });

  it("reserve the plan-card and plan-detail layouts", () => {
    const cards = render(<SkeletonPlanCards cards={2} label="Loading plans" />);
    expect(screen.getByRole("status").textContent).toContain("Loading plans");
    expect(cards.container.querySelectorAll(".panel")).toHaveLength(2);
    cleanup();

    const detail = render(<SkeletonPlanDetail label="Loading plan" />);
    expect(screen.getByRole("status").textContent).toContain("Loading plan");
    expect(detail.container.querySelectorAll(".panel")).toHaveLength(3);
  });
});

describe("plan views while loading", () => {
  it("shows plan-card skeletons on the catalogue until the request resolves", () => {
    // Never settles: the page must stay in its loading state.
    apiMock.plans.mockReturnValue(new Promise(() => {}));
    render(<SubscribePage />);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Loading plans");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll(".panel").length).toBeGreaterThan(0);
  });

  it("shows plan-card skeletons on a merchant catalogue", () => {
    search = `address=${MERCHANT}`;
    apiMock.plans.mockReturnValue(new Promise(() => {}));
    render(<MerchantPublicPage />);

    expect(
      screen.getAllByRole("status").some((el) => el.textContent?.includes("Loading plans")),
    ).toBe(true);
  });

  it("shows the plan-detail skeleton instead of a bare Loading… line", () => {
    apiMock.plans.mockReturnValue(new Promise(() => {}));
    render(<PlanPageClient planId={String(plan().id)} />);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Loading plan");
    expect(status.getAttribute("aria-busy")).toBe("true");
  });
});
