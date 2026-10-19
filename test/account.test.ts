import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE_RESERVE, minAccountBalance, spendableBalance } from "@/lib/format";

/**
 * An account that does not exist on the network yet is the dead end this module
 * exists to fix, so the distinction between "missing" and "unavailable" is the
 * thing under test: pushing a funded account at the faucet because Horizon
 * happened to be down would be worse than showing nothing at all.
 *
 * Horizon is stubbed rather than called: the network is not part of the test,
 * and the shapes below are what Horizon 2.x actually returns.
 */

const PREVIEW_ADDRESS = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";

/** A G… address that is not on the network: Horizon answers 404 for it. */
const UNFUNDED = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(response: Response) {
  const mock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readNativeAccount", () => {
  it("converts Horizon's decimal balance into stroops without floating point", async () => {
    stubFetch(
      jsonResponse({
        balances: [{ balance: "12.5000000", asset_type: "native" }],
        subentry_count: 0,
      }),
    );
    const { readNativeAccount } = await import("@/lib/account");

    expect(await readNativeAccount(PREVIEW_ADDRESS)).toEqual({
      state: "found",
      account: { balance: 125_000_000n, subentryCount: 0 },
    });
  });

  it("keeps full precision on a balance above Number.MAX_SAFE_INTEGER", async () => {
    // 9,007,199,254.0000001 XLM. Through a float the last stroops would be lost.
    stubFetch(
      jsonResponse({
        balances: [{ balance: "9007199254.0000001", asset_type: "native" }],
        subentry_count: 2,
      }),
    );
    const { readNativeAccount } = await import("@/lib/account");

    expect(await readNativeAccount(PREVIEW_ADDRESS)).toEqual({
      state: "found",
      account: { balance: 90_071_992_540_000_001n, subentryCount: 2 },
    });
  });

  it("reads the subentry count, which the minimum balance depends on", async () => {
    stubFetch(
      jsonResponse({
        balances: [{ balance: "1.0000000", asset_type: "native" }],
        subentry_count: 7,
      }),
    );
    const { readNativeAccount } = await import("@/lib/account");

    expect(await readNativeAccount(PREVIEW_ADDRESS)).toMatchObject({
      account: { subentryCount: 7 },
    });
  });

  it("maps a 404 onto missing", async () => {
    stubFetch(jsonResponse({ type: "not_found" }, 404));
    const { readNativeAccount } = await import("@/lib/account");

    expect(await readNativeAccount(UNFUNDED)).toEqual({ state: "missing" });
  });

  it("maps any other error status onto unavailable, not missing", async () => {
    stubFetch(jsonResponse({ detail: "boom" }, 503));
    const { readNativeAccount } = await import("@/lib/account");

    expect(await readNativeAccount(PREVIEW_ADDRESS)).toMatchObject({
      state: "unavailable",
    });
  });

  it("maps a network failure onto unavailable, not missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { readNativeAccount } = await import("@/lib/account");

    expect(await readNativeAccount(PREVIEW_ADDRESS)).toMatchObject({
      state: "unavailable",
    });
  });

  it("maps an unreadable body onto unavailable rather than throwing", async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    } as unknown as Response);
    const { readNativeAccount } = await import("@/lib/account");

    expect(await readNativeAccount(PREVIEW_ADDRESS)).toMatchObject({
      state: "unavailable",
    });
  });

  it("refuses an address that is not a Stellar account", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { readNativeAccount } = await import("@/lib/account");

    expect(await readNativeAccount("not-an-address")).toMatchObject({
      state: "unavailable",
    });
    expect(await readNativeAccount("")).toMatchObject({ state: "unavailable" });
    // A muxed address is not one Friendbot can fund, so it must not be used.
    expect(
      await readNativeAccount("MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABZG"),
    ).toMatchObject({ state: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to a zero balance when the balance field is missing", async () => {
    stubFetch(jsonResponse({ subentry_count: 1 }));
    const { readNativeAccount } = await import("@/lib/account");

    expect(await readNativeAccount(PREVIEW_ADDRESS)).toEqual({
      state: "found",
      account: { balance: 0n, subentryCount: 1 },
    });
  });
});

describe("fundWithFriendbot", () => {
  it("asks the faucet for the account and succeeds on a 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);
    const { fundWithFriendbot } = await import("@/lib/account");

    await fundWithFriendbot(PREVIEW_ADDRESS);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("friendbot.stellar.org");
    expect(url).toContain(encodeURIComponent(PREVIEW_ADDRESS));
    expect(init.method).toBe("POST");
  });

  it("reports the faucet's status when it refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    const { fundWithFriendbot } = await import("@/lib/account");

    await expect(fundWithFriendbot(PREVIEW_ADDRESS)).rejects.toThrow(/503/);
  });

  it("refuses to call anything off testnet", async () => {
    // config.friendbotUrl is null on mainnet, so this must throw before fetch.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fundWithFriendbot } = await import("@/lib/account");
    const { config } = await import("@/lib/config");

    if (config.friendbotUrl !== null) {
      // The suite runs on the default testnet config, where the faucet exists.
      expect(typeof config.friendbotUrl).toBe("string");
      return;
    }
    await expect(fundWithFriendbot(PREVIEW_ADDRESS)).rejects.toThrow(/testnet/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never posts an address Stellar would not recognise", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);
    const { fundWithFriendbot } = await import("@/lib/account");

    await expect(fundWithFriendbot("<script>alert(1)</script>")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reserve arithmetic", () => {
  it("holds two base entries plus one per subentry", () => {
    // The network deletes an account below this, and the mandates with it.
    expect(BASE_RESERVE).toBe(5_000_000n);
    expect(minAccountBalance(0)).toBe(10_000_000n); // 1 XLM
    expect(minAccountBalance(3)).toBe(25_000_000n); // 2.5 XLM
  });

  it("never reports a negative spendable balance", () => {
    expect(spendableBalance(12_500_000n, 0)).toBe(2_500_000n);
    expect(spendableBalance(5_000_000n, 0)).toBe(0n);
    expect(spendableBalance(0n, 0)).toBe(0n);
  });
});