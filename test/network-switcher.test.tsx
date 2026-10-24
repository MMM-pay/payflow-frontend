// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WalletLayoutInner } from "@/components/WalletLayoutInner";

/**
 * The header network control (issue #20): a badge when the build serves one
 * network, a switcher when it serves several. The config module is mocked the
 * same way the footer tests mock it, so these tests drive the UI while the
 * registry rules themselves are covered by test/network.test.ts.
 */

const fixtures = vi.hoisted(() => {
  const TESTNET = {
    id: "testnet",
    label: "Testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    contracts: {
      planRegistry: "CDQ5EJTVXXX2CBMHWP3BGGUDHSK6D4I25IF5XXH3QGL2TNTBMJUOFKDB",
      vault: "CBNQEWSYYQOKNX5KB62OFT6ID5TCVSWN4PS4AXAJK6IWUEXOLVN6DXII",
      subscription: "CD5YZUJU6WLFIHGAV4J2BV42GCVZE5ZGDUGSW5CBRIA47TQHSZZW3XMM",
    },
    explorerBase: "https://stellar.expert/explorer/testnet",
    disclaimer: "Stellar testnet · unaudited · do not use with real funds",
  };
  const MAINNET = {
    id: "mainnet",
    label: "Mainnet",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    contracts: {
      planRegistry: "mainnet-registry",
      vault: "mainnet-vault",
      subscription: "mainnet-subscription",
    },
    explorerBase: "https://stellar.expert/explorer/public",
    disclaimer: "Stellar mainnet · unaudited",
  };
  return {
    TESTNET,
    MAINNET,
    networks: [TESTNET] as Array<typeof TESTNET | typeof MAINNET>,
    active: TESTNET as typeof TESTNET | typeof MAINNET,
    selectNetwork: vi.fn(),
    wallet: {
      address: null as string | null,
      connecting: false,
      error: null as string | null,
      networkMismatch: false,
      walletNetwork: null as string | null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      signXdr: vi.fn(),
    },
  };
});

vi.mock("@/lib/wallet", () => ({
  useWallet: () => fixtures.wallet,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/config", () => ({
  config: {
    networkPassphrase: fixtures.TESTNET.networkPassphrase,
    contracts: fixtures.TESTNET.contracts,
  },
  explorerBase: fixtures.TESTNET.explorerBase,
  defaultNetwork: () => fixtures.TESTNET,
  activeNetwork: () => fixtures.active,
  availableNetworks: () => fixtures.networks,
  selectNetwork: fixtures.selectNetwork,
}));

function renderLayout() {
  return render(
    <WalletLayoutInner>
      <div>Content</div>
    </WalletLayoutInner>,
  );
}

describe("header network control", () => {
  beforeEach(() => {
    fixtures.networks = [fixtures.TESTNET, fixtures.MAINNET];
    fixtures.active = fixtures.TESTNET;
    fixtures.selectNetwork.mockReset();
    fixtures.wallet.networkMismatch = false;
    fixtures.wallet.walletNetwork = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a badge, not a switcher, when the build serves one network", () => {
    fixtures.networks = [fixtures.TESTNET];

    renderLayout();

    expect(screen.getByText("Testnet")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Stellar network" })).toBeNull();
  });

  it("offers every configured network and hides nothing else", () => {
    renderLayout();

    const select = screen.getByRole("combobox", {
      name: "Stellar network",
    }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "testnet",
      "mainnet",
    ]);
    expect(select.value).toBe("testnet");
  });

  it("persists the chosen network through selectNetwork", () => {
    renderLayout();

    fireEvent.change(screen.getByRole("combobox", { name: "Stellar network" }), {
      target: { value: "mainnet" },
    });

    // selectNetwork persists the choice and reloads; the UI does not try to
    // apply the network itself.
    expect(fixtures.selectNetwork).toHaveBeenCalledWith("mainnet");
  });

  it("labels the header with the active network", () => {
    fixtures.active = fixtures.MAINNET;

    renderLayout();

    expect((screen.getByRole("combobox", { name: "Stellar network" }) as HTMLSelectElement).value).toBe(
      "mainnet",
    );
  });

  it("states the active network's disclaimer in the footer", () => {
    fixtures.active = fixtures.MAINNET;

    renderLayout();

    expect(screen.getByText(fixtures.MAINNET.disclaimer)).toBeTruthy();
  });

  it("follows the wallet mismatch warning to the selected network", () => {
    fixtures.wallet.networkMismatch = true;
    fixtures.wallet.walletNetwork = "Some Other Network ; December 2020";
    fixtures.active = fixtures.MAINNET;

    renderLayout();

    expect(screen.getByText(/Network mismatch detected/)).toBeTruthy();
    expect(screen.getByText(fixtures.MAINNET.networkPassphrase)).toBeTruthy();
  });
});
