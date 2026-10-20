import { describe, expect, it } from "vitest";
import {
  formatCommit,
  formatVersion,
  getCommitUrl,
  getContractUrl,
  getProtocolContractLinks,
  REPO_URL,
} from "@/lib/build-info";
import { explorerBase } from "@/lib/config";

describe("build-info pure helpers", () => {
  describe("formatVersion", () => {
    it("adds a leading v to semantic versions without one", () => {
      expect(formatVersion("0.2.0")).toBe("v0.2.0");
      expect(formatVersion("1.0.0-beta.1")).toBe("v1.0.0-beta.1");
    });

    it("preserves versions that already have a leading v", () => {
      expect(formatVersion("v0.2.0")).toBe("v0.2.0");
      expect(formatVersion("v1.5.0")).toBe("v1.5.0");
    });

    it("returns empty string for missing, empty, or whitespace inputs", () => {
      expect(formatVersion()).toBe("");
      expect(formatVersion("")).toBe("");
      expect(formatVersion("   ")).toBe("");
    });
  });

  describe("formatCommit", () => {
    it("slices long commit SHAs to the standard 7-character short hash", () => {
      expect(formatCommit("e7d5bb0123456789abcdef0123456789abcdef01")).toBe("e7d5bb0");
    });

    it("preserves an already short 7-character commit hash", () => {
      expect(formatCommit("e7d5bb0")).toBe("e7d5bb0");
    });

    it("returns empty string for missing, empty, or whitespace inputs", () => {
      expect(formatCommit()).toBe("");
      expect(formatCommit("")).toBe("");
      expect(formatCommit("   ")).toBe("");
    });
  });

  describe("getCommitUrl", () => {
    it("builds the GitHub commit URL using the short commit hash", () => {
      expect(getCommitUrl("e7d5bb0")).toBe(
        `${REPO_URL}/commit/e7d5bb0`,
      );
      expect(getCommitUrl("e7d5bb0123456789abcdef")).toBe(
        `${REPO_URL}/commit/e7d5bb0`,
      );
    });

    it("supports a custom repository URL", () => {
      expect(
        getCommitUrl("e7d5bb0", "https://github.com/custom-org/custom-repo"),
      ).toBe("https://github.com/custom-org/custom-repo/commit/e7d5bb0");
    });

    it("returns null when commit hash is empty or absent", () => {
      expect(getCommitUrl()).toBeNull();
      expect(getCommitUrl("")).toBeNull();
      expect(getCommitUrl("   ")).toBeNull();
    });
  });

  describe("getContractUrl", () => {
    it("builds the Stellar Expert explorer URL for a given contract ID", () => {
      const id = "CDQ5EJTVXXX2CBMHWP3BGGUDHSK6D4I25IF5XXH3QGL2TNTBMJUOFKDB";
      expect(getContractUrl(id)).toBe(`${explorerBase}/contract/${id}`);
    });

    it("supports a custom explorer base URL", () => {
      const id = "CDQ5EJTVXXX2CBMHWP3BGGUDHSK6D4I25IF5XXH3QGL2TNTBMJUOFKDB";
      const customBase = "https://stellar.expert/explorer/public";
      expect(getContractUrl(id, customBase)).toBe(`${customBase}/contract/${id}`);
    });

    it("returns null for missing or whitespace IDs", () => {
      expect(getContractUrl()).toBeNull();
      expect(getContractUrl("")).toBeNull();
      expect(getContractUrl("   ")).toBeNull();
    });
  });

  describe("getProtocolContractLinks", () => {
    it("returns items for Plan registry, Vault, and Subscription", () => {
      const testContracts = {
        planRegistry: "CDQ5EJTVXXX2CBMHWP3BGGUDHSK6D4I25IF5XXH3QGL2TNTBMJUOFKDB",
        vault: "CBNQEWSYYQOKNX5KB62OFT6ID5TCVSWN4PS4AXAJK6IWUEXOLVN6DXII",
        subscription: "CD5YZUJU6WLFIHGAV4J2BV42GCVZE5ZGDUGSW5CBRIA47TQHSZZW3XMM",
      };

      const links = getProtocolContractLinks(testContracts);
      expect(links).toHaveLength(3);

      expect(links[0]).toEqual({
        name: "Plan registry",
        id: testContracts.planRegistry,
        shortId: "CDQ5…FKDB",
        url: `${explorerBase}/contract/${testContracts.planRegistry}`,
      });

      expect(links[1]).toEqual({
        name: "Vault",
        id: testContracts.vault,
        shortId: "CBNQ…DXII",
        url: `${explorerBase}/contract/${testContracts.vault}`,
      });

      expect(links[2]).toEqual({
        name: "Subscription",
        id: testContracts.subscription,
        shortId: "CD5Y…3XMM",
        url: `${explorerBase}/contract/${testContracts.subscription}`,
      });
    });

    it("handles missing or empty contract IDs gracefully without crashing", () => {
      const links = getProtocolContractLinks({
        planRegistry: "",
        vault: "   ",
        subscription: undefined,
      });

      expect(links).toHaveLength(3);
      expect(links[0]).toEqual({
        name: "Plan registry",
        id: "",
        shortId: "",
        url: null,
      });
      expect(links[1]).toEqual({
        name: "Vault",
        id: "",
        shortId: "",
        url: null,
      });
      expect(links[2]).toEqual({
        name: "Subscription",
        id: "",
        shortId: "",
        url: null,
      });
    });
  });
});
