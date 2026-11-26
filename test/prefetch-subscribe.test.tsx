// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MerchantPublicPage from "@/app/m/page";
import SubscribePage from "@/app/subscribe/page";
import type { ApiPlan } from "@/lib/api";

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";

let search = "";

const routerMock = vi.hoisted(() => ({
  prefetch: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

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
const chainMock = vi.hoisted(() => ({ chainPlansOf: vi.fn(), chainPlans: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
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
  chainPlansOf: chainMock.chainPlansOf,
  chainPlans: chainMock.chainPlans,
}));
vi.mock("@/lib/token", () => ({
  metaFor: () => ({ symbol: "XLM", decimals: 7 }),
  useTokenMetas: () => new Map(),
}));
vi.mock("@/lib/toml", () => ({ useOrgName: () => "Acme Payments" }));
vi.mock("@/lib/config", () => ({
  config: {
    rpcUrl: "http://localhost:8000/rpc",
    rpcUrls: ["http://localhost:8000/rpc"],
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "TESTNET",
    apiUrl: "",
    contracts: { payflow: "C123", token: "C456" },
    readSource: "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE",
    networkPresets: [],
  },
  explorerBase: "https://stellar.expert/explorer/testnet",
}));

const SAMPLE_PLAN: ApiPlan = {
  id: 42,
  merchant: MERCHANT,
  name: "Pro Monthly",
  token: "C456",
  amount: "10000000",
  period: 2592000,
  active: 1,
  ledger: 0,
};

describe("Plan card prefetch (#327)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search = "";
    apiMock.plans.mockResolvedValue({ plans: [SAMPLE_PLAN] });
    chainMock.chainPlansOf.mockResolvedValue([SAMPLE_PLAN]);
    chainMock.chainPlans.mockResolvedValue([SAMPLE_PLAN]);
  });

  afterEach(() => {
    cleanup();
  });

  it("prefetches /subscribe when a plan card is hovered or focused in MerchantPublicPage", async () => {
    search = `address=${MERCHANT}`;
    render(<MerchantPublicPage />);

    const cardTitle = await screen.findByText("Pro Monthly");
    const panel = cardTitle.closest("section");
    expect(panel).not.toBeNull();

    fireEvent.mouseEnter(panel!);
    expect(routerMock.prefetch).toHaveBeenCalledWith("/subscribe");
    expect(routerMock.prefetch).toHaveBeenCalledWith("/subscribe/?plan=42");

    routerMock.prefetch.mockClear();
    fireEvent.focus(panel!);
    expect(routerMock.prefetch).toHaveBeenCalledWith("/subscribe");
    expect(routerMock.prefetch).toHaveBeenCalledWith("/subscribe/?plan=42");
  });

  it("prefetches plan route when a plan card is hovered or focused in SubscribePage", async () => {
    search = "";
    render(<SubscribePage />);

    const cardTitle = await screen.findByText("Pro Monthly");
    const panel = cardTitle.closest("section");
    expect(panel).not.toBeNull();

    fireEvent.mouseEnter(panel!);
    expect(routerMock.prefetch).toHaveBeenCalledWith("/subscribe/?plan=42");

    routerMock.prefetch.mockClear();
    fireEvent.focus(panel!);
    expect(routerMock.prefetch).toHaveBeenCalledWith("/subscribe/?plan=42");
  });
});
