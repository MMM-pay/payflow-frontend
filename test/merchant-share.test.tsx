// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MerchantPage from "@/app/merchant/page";
import { qrMatrix } from "@/lib/qr";

/**
 * The share links of a plan (issue #19). A merchant sends a customer to one
 * plan, so the link has to name the plan and carry the base path the site is
 * served from — on GitHub Pages the app lives under `/payflow-frontend`, and
 * a link without it 404s.
 */

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";

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
  // The page asks whether an indexer is configured before every read.
  isConfigured: () => true,
  plans: vi.fn(),
  mandatesFor: vi.fn(),
  merchantSummary: vi.fn(),
  merchantRevenue: vi.fn(),
  // The dashboard loads these panels too; share links do not depend on them,
  // so they answer "nothing to show".
  merchantChurn: vi.fn(),
  merchantCohortRetention: vi.fn(),
  webhooks: vi.fn(),
  charges: vi.fn(),
  planStats: vi.fn(),
  // The live-event stream is not what these cases exercise.
  stream: () => ({ close: () => {}, addEventListener: () => {} }),
}));

const payflowMock = vi.hoisted(() => ({
  feeBps: vi.fn(),
  createPlan: vi.fn(),
  setPlanActive: vi.fn(),
  charge: vi.fn(),
  endMandate: vi.fn(),
  // Capability probes the dashboard runs on load; share links need none of
  // them, so they answer "not supported".
  supportsPlanRename: async () => false,
  supportsPlanDescription: async () => false,
  supportsTrials: () => false,
}));

const chainMock = vi.hoisted(() => ({
  chainMandatesFor: vi.fn(),
  chainMerchantSummary: vi.fn(),
  chainPlansOf: vi.fn(),
  endable: vi.fn(() => false),
}));

vi.mock("@/lib/wallet", () => ({ useWallet: () => wallet }));
// The page imports more from this module than it reads here, so keep the real
// exports and replace only the client.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: apiMock,
}));
// Keep the module's real constants and helpers; only the client is faked.
vi.mock("@/lib/payflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payflow")>()),
  payflow: payflowMock,
}));
// Same reason as the api mock: the page imports more from this module than
// these cases drive.
vi.mock("@/lib/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chain")>()),
  ...chainMock,
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
    horizonUrl: "http://localhost:8081",
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "TESTNET",
    apiUrl: "",
    // The static export is served from a sub-path on GitHub Pages.
    basePath: "/payflow-frontend",
    readSource: "GAKOHW5FUKSF3SXQQWLD647RQJPOR5RZOS4ITSMWC5NPC67DEXXYU43H",
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

beforeEach(() => {
  wallet.address = MERCHANT;
  wallet.networkMismatch = false;
  apiMock.plans.mockResolvedValue({
    plans: [
      {
        id: 1,
        merchant: MERCHANT,
        name: "Pro Monthly",
        token: "",
        amount: "10000000",
        period: 2_592_000,
        active: 1,
        ledger: 0,
      },
    ],
  });
  apiMock.mandatesFor.mockResolvedValue({ mandates: [] });
  apiMock.merchantSummary.mockResolvedValue(null);
  apiMock.merchantRevenue.mockResolvedValue(null);
  apiMock.merchantChurn.mockResolvedValue(null);
  apiMock.merchantCohortRetention.mockResolvedValue(null);
  apiMock.webhooks.mockResolvedValue(null);
  apiMock.charges.mockResolvedValue(null);
  apiMock.planStats.mockResolvedValue(null);
  payflowMock.feeBps.mockResolvedValue(100);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MerchantPage share links", () => {
  it("offers a link and a QR code for every plan", async () => {
    render(<MerchantPage />);

    expect(await screen.findByRole("button", { name: /show qr/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy link to pro monthly/i })).toBeTruthy();
  });

  it("builds the link with the base path the site is served from", async () => {
    render(<MerchantPage />);

    await screen.findByRole("button", { name: /show qr/i });
    fireEvent.click(screen.getByRole("button", { name: /show qr/i }));

    const link = await screen.findByText(
      /\/payflow-frontend\/subscribe\/\?plan=1$/,
    );
    expect(link.textContent).toBe(
      `${window.location.origin}/payflow-frontend/subscribe/?plan=1`,
    );
  });

  it("draws the QR code of that link", async () => {
    render(<MerchantPage />);

    await screen.findByRole("button", { name: /show qr/i });
    fireEvent.click(screen.getByRole("button", { name: /show qr/i }));

    const code = await screen.findByRole("img", { name: /qr code for the link/i });
    const path = code.querySelector("path")?.getAttribute("d") ?? "";

    // The drawn modules are the modules of the code of the link.
    const drawn = new Set(
      [...path.matchAll(/M(\d+) (\d+)/g)].map((m) => `${m[1]},${m[2]}`),
    );
    const expected = qrMatrix(
      `${window.location.origin}/payflow-frontend/subscribe/?plan=1`,
    )
      .flatMap((row, y) => row.map((dark, x) => (dark ? `${x},${y}` : null)))
      .filter((v): v is string => v !== null);

    expect(drawn.size).toBe(expected.length);
    for (const cell of expected) expect(drawn.has(cell)).toBe(true);
  });

  it("hides the code again and shows only one at a time", async () => {
    render(<MerchantPage />);

    await screen.findByRole("button", { name: /show qr/i });
    fireEvent.click(screen.getByRole("button", { name: /show qr/i }));

    expect(await screen.findByRole("img", { name: /qr code for the link/i })).toBeTruthy();
    const hide = screen.getByRole("button", { name: /hide qr/i });
    expect(hide.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(hide);
    expect(screen.queryByRole("img", { name: /qr code for the link/i })).toBeNull();
  });
});
