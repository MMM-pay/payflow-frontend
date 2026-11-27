import { describe, expect, it, vi } from "vitest";
import {
  detectMissingWallet,
  EXTENSION_WALLET_IDS,
  hasNoExtensionWallet,
  RECOMMENDED_WALLETS,
} from "@/lib/wallet-detect";

const wallet = (id: string, isAvailable: boolean) => ({ id, isAvailable });

describe("hasNoExtensionWallet", () => {
  it("is true when every extension wallet is unavailable, even if web wallets are", () => {
    expect(
      hasNoExtensionWallet([
        wallet("freighter", false),
        wallet("lobstr", false),
        wallet("albedo", true),
        wallet("xbull", true),
        wallet("walletconnect", true),
      ]),
    ).toBe(true);
  });

  it("is false as soon as one extension wallet is available", () => {
    expect(hasNoExtensionWallet([wallet("freighter", false), wallet("rabet", true)])).toBe(false);
    expect(hasNoExtensionWallet([wallet("freighter", true)])).toBe(false);
  });

  it("matches ids case-insensitively", () => {
    expect(hasNoExtensionWallet([wallet("FREIGHTER", true)])).toBe(false);
    expect(hasNoExtensionWallet([wallet("Freighter", false)])).toBe(true);
  });

  it("does not guess when the list says nothing about extension wallets", () => {
    expect(hasNoExtensionWallet([])).toBe(false);
    expect(hasNoExtensionWallet([wallet("albedo", true)])).toBe(false);
  });

  it("does not guess from malformed input", () => {
    for (const bad of [undefined, null, "freighter", 42, {}, [null], [undefined], [{}], ["x"]]) {
      expect(hasNoExtensionWallet(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("treats a non-boolean availability as not available", () => {
    expect(hasNoExtensionWallet([{ id: "freighter", isAvailable: "yes" }])).toBe(true);
  });
});

describe("detectMissingWallet", () => {
  it("reports a missing wallet from the kit's supported list", async () => {
    const getSupportedWallets = vi.fn().mockResolvedValue([wallet("freighter", false)]);
    await expect(detectMissingWallet({ getSupportedWallets })).resolves.toBe(true);
  });

  it("reports an installed wallet", async () => {
    const getSupportedWallets = vi.fn().mockResolvedValue([wallet("freighter", true)]);
    await expect(detectMissingWallet({ getSupportedWallets })).resolves.toBe(false);
  });

  it("answers false when the kit cannot list wallets", async () => {
    await expect(detectMissingWallet({})).resolves.toBe(false);
  });

  it("answers false, without throwing, when the probe fails", async () => {
    const getSupportedWallets = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(detectMissingWallet({ getSupportedWallets })).resolves.toBe(false);
  });
});

describe("install guidance data", () => {
  it("recommends wallets that are among the detected extensions, over https", () => {
    expect(RECOMMENDED_WALLETS.length).toBeGreaterThan(0);
    expect(RECOMMENDED_WALLETS[0]?.name).toBe("Freighter");
    for (const w of RECOMMENDED_WALLETS) {
      expect(w.url.startsWith("https://")).toBe(true);
      expect(EXTENSION_WALLET_IDS).toContain(w.name.toLowerCase());
    }
  });
});
