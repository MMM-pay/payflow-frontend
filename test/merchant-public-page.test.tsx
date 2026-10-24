// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MerchantPublicPage from "@/app/m/page";
import type { ApiPlan } from "@/lib/api";

/**
 * The public catalogue (issue #44): `/m/?address=G…` a merchant can link to.
 * The cases that matter are the ones the issue calls out — contract-only mode
 * (no indexer), a visitor with no wallet, and a link that is not a valid
 * merchant address at all.
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
const chainMock = vi.hoisted(() => ({ chainPlansOf: vi.fn() }));
const payflowMock = vi.hoisted(() => ({ subscribe: vi.fn() }));

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
  chainPlansOf: chainMock.chainPlansOf,
}));
vi.mock("@/lib/config", () => ({
  config: {
    rpcUrl: "http://localhost:8000/rpc",
    rpcUrls: ["http://localhost:8000/rpc"],
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "TESTNET",
    apiUrl: "",
    readSource: "GAKOHW5FUKSF3SXQQWLD647RQJPOR5RZOS4ITSMWC5NPC67DEXXYU43H",
    horizonUrl: "http://localhost:8081",
    contracts: {
      planRegistry: "CDQ5EJTVXXX2CBMHWP3BGGUDHSK6D4I25IF5XXH3QGL2TNTBMJUOFKDB",
      vault: "CBNQEWSYYQOKNX5KB62OFT6ID5TCVSWN4PS4AXAJK6IWUEXOLVN6DXII",
      subscription: "CD5YZUJU6WLFIHGAV4J2BV42GCVZE5ZGDUGSW5CBRIA47TQHSZZW3XMM",
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    },
  },
  explorerBase: "https://stellar.expert/explorer/testnet",
  requireContracts: () => {},
}));
vi.mock("@/lib/token", () => ({
  metaFor: () => ({ symbol: "XLM", decimals: 7 }),
  useTokenMetas: () => new Map(),
}));
vi.mock("@/lib/toml", () => ({ useOrgName: () => "Acme Payments" }));
vi.mock("@/lib/payflow", async (importOriginal) => ({
  // The real chain.ts (imported above) needs MAX_PAGE and mandateStatus.
  ...(await importOriginal<typeof import("@/lib/payflow")>()),
  payflow: payflowMock,
}));

function plan(overrides: Partial<ApiPlan> = {}): ApiPlan {
  return {
    id: 1,
    merchant: MERCHANT,
    name: "Pro Monthly",
    token: "",
    amount: "10000000", // 1 XLM
    period: 2_592_000,
    active: 1,
    ledger: 0,
    ...overrides,
  };
}

beforeEach(() => {
  wallet.address = null;
  wallet.networkMismatch = false;
  wallet.signXdr.mockReset();
  apiMock.plans.mockReset();
  chainMock.chainPlansOf.mockReset();
  payflowMock.subscribe.mockReset();
});

afterEach(cleanup);

describe("MerchantPublicPage", () => {
  it("explains a link that carries no merchant address", () => {
    search = "";
    render(<MerchantPublicPage />);
    expect(screen.getByText(/missing a merchant address/i)).toBeTruthy();
    expect(apiMock.plans).not.toHaveBeenCalled();
    expect(chainMock.chainPlansOf).not.toHaveBeenCalled();
  });

  it("rejects a link whose address is not a valid account", () => {
    search = "address=not-a-wallet";
    render(<MerchantPublicPage />);
    expect(screen.getByText(/missing a merchant address/i)).toBeTruthy();
    expect(chainMock.chainPlansOf).not.toHaveBeenCalled();
  });

  it("lists active plans straight from the contract when there is no indexer", async () => {
    // Contract-only mode, the demo's reality: api.plans answers null and the
    // catalogue must come from chain state instead.
    search = `address=${MERCHANT}`;
    apiMock.plans.mockResolvedValue(null);
    chainMock.chainPlansOf.mockResolvedValue([
      plan(),
      plan({ id: 2, name: "Yearly", active: 0 }),
    ]);

    render(<MerchantPublicPage />);

    expect(await screen.findByText("Pro Monthly")).toBeTruthy();
    const card = screen.getByText("Pro Monthly").closest("section");
    expect(card?.textContent).toContain("1 XLM");
    expect(card?.textContent).toContain("per month");
    // The deactivated plan must not be offered.
    expect(screen.queryByText("Yearly")).toBeNull();
    // The read source is the visitor's wallet when present, else the app's.
    expect(chainMock.chainPlansOf).toHaveBeenCalledWith(
      "GAKOHW5FUKSF3SXQQWLD647RQJPOR5RZOS4ITSMWC5NPC67DEXXYU43H",
      MERCHANT,
    );
    expect(screen.getByText(/reading plans directly from the contract/i)).toBeTruthy();
  });

  it("names the merchant from their stellar.toml", async () => {
    search = `address=${MERCHANT}`;
    apiMock.plans.mockResolvedValue({ plans: [plan()] });

    render(<MerchantPublicPage />);

    expect(await screen.findByText("Acme Payments")).toBeTruthy();
  });

  it("asks a wallet-less visitor to connect before subscribing", async () => {
    search = `address=${MERCHANT}`;
    apiMock.plans.mockResolvedValue({ plans: [plan()] });

    render(<MerchantPublicPage />);

    const button = (await screen.findByRole("button", {
      name: "Connect wallet to subscribe",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("subscribes the connected wallet with an open-ended mandate by default", async () => {
    search = `address=${MERCHANT}`;
    wallet.address = SUBSCRIBER;
    payflowMock.subscribe.mockResolvedValue("deadbeef");
    apiMock.plans.mockResolvedValue({ plans: [plan()] });

    render(<MerchantPublicPage />);

    const button = (await screen.findByRole("button", {
      name: "Subscribe",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);

    expect(await screen.findByText(/subscribed/i)).toBeTruthy();
    expect(payflowMock.subscribe).toHaveBeenCalledWith(
      SUBSCRIBER,
      wallet.signXdr,
      1,
      0,
    );
  });
});
