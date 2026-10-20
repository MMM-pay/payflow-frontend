// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WalletLayoutInner } from "@/components/WalletLayoutInner";

const mockWallet = vi.hoisted(() => ({
  address: null as string | null,
  connecting: false,
  error: null as string | null,
  networkMismatch: false,
  walletNetwork: null as string | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  signXdr: vi.fn(),
}));

vi.mock("@/lib/wallet", () => ({
  useWallet: () => mockWallet,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

const mockConfig = vi.hoisted(() => ({
  networkPassphrase: "Test SDF Network ; September 2015",
  contracts: {
    planRegistry: "CDQ5EJTVXXX2CBMHWP3BGGUDHSK6D4I25IF5XXH3QGL2TNTBMJUOFKDB",
    vault: "CBNQEWSYYQOKNX5KB62OFT6ID5TCVSWN4PS4AXAJK6IWUEXOLVN6DXII",
    subscription: "CD5YZUJU6WLFIHGAV4J2BV42GCVZE5ZGDUGSW5CBRIA47TQHSZZW3XMM",
  },
}));

vi.mock("@/lib/config", () => ({
  config: mockConfig,
  explorerBase: "https://stellar.expert/explorer/testnet",
}));

vi.mock("@/lib/build-info", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/build-info")>();
  return {
    ...actual,
    APP_VERSION: "0.2.0",
    COMMIT_HASH: "e7d5bb0",
  };
});

describe("WalletLayoutInner footer", () => {
  beforeEach(() => {
    mockConfig.contracts = {
      planRegistry: "CDQ5EJTVXXX2CBMHWP3BGGUDHSK6D4I25IF5XXH3QGL2TNTBMJUOFKDB",
      vault: "CBNQEWSYYQOKNX5KB62OFT6ID5TCVSWN4PS4AXAJK6IWUEXOLVN6DXII",
      subscription: "CD5YZUJU6WLFIHGAV4J2BV42GCVZE5ZGDUGSW5CBRIA47TQHSZZW3XMM",
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("renders app version and short commit hash linked to GitHub", () => {
    render(
      <WalletLayoutInner>
        <div>Content</div>
      </WalletLayoutInner>,
    );

    // App version should be formatted with a leading 'v'
    expect(screen.getByText(/v0\.2\.0/)).toBeTruthy();

    // Commit hash link
    const commitLink = screen.getByRole("link", { name: "Git commit e7d5bb0" });
    expect(commitLink.getAttribute("href")).toBe(
      "https://github.com/MMM-pay/payflow-frontend/commit/e7d5bb0",
    );
    expect(commitLink.getAttribute("target")).toBe("_blank");
  });

  it("renders links to the three core protocol contracts on the explorer", () => {
    render(
      <WalletLayoutInner>
        <div>Content</div>
      </WalletLayoutInner>,
    );

    const planRegistryLink = screen.getByRole("link", {
      name: `Plan registry contract on Stellar Expert: ${mockConfig.contracts.planRegistry}`,
    });
    expect(planRegistryLink.getAttribute("href")).toBe(
      `https://stellar.expert/explorer/testnet/contract/${mockConfig.contracts.planRegistry}`,
    );
    expect(planRegistryLink.textContent).toBe("CDQ5…FKDB");

    const vaultLink = screen.getByRole("link", {
      name: `Vault contract on Stellar Expert: ${mockConfig.contracts.vault}`,
    });
    expect(vaultLink.getAttribute("href")).toBe(
      `https://stellar.expert/explorer/testnet/contract/${mockConfig.contracts.vault}`,
    );
    expect(vaultLink.textContent).toBe("CBNQ…DXII");

    const subLink = screen.getByRole("link", {
      name: `Subscription contract on Stellar Expert: ${mockConfig.contracts.subscription}`,
    });
    expect(subLink.getAttribute("href")).toBe(
      `https://stellar.expert/explorer/testnet/contract/${mockConfig.contracts.subscription}`,
    );
    expect(subLink.textContent).toBe("CD5Y…3XMM");
  });

  it("handles unconfigured contracts without broken links", () => {
    mockConfig.contracts = {
      planRegistry: "",
      vault: "",
      subscription: "",
    };

    render(
      <WalletLayoutInner>
        <div>Content</div>
      </WalletLayoutInner>,
    );

    const unconfigured = screen.getAllByText("not configured");
    expect(unconfigured).toHaveLength(3);
    expect(screen.queryByRole("link", { name: /contract on Stellar Expert/ })).toBeNull();
  });

  it("renders the testnet disclaimer and GitHub link", () => {
    render(
      <WalletLayoutInner>
        <div>Content</div>
      </WalletLayoutInner>,
    );

    expect(
      screen.getByText("Stellar testnet · unaudited · do not use with real funds"),
    ).toBeTruthy();

    const githubLink = screen.getByRole("link", { name: "GitHub" });
    expect(githubLink.getAttribute("href")).toBe("https://github.com/MMM-pay");
  });
});
