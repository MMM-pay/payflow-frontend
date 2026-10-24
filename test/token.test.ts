import { beforeEach, describe, expect, it, vi } from "vitest";
import { XLM } from "@/lib/format";

/**
 * Token metadata is read from the token contract and cached. Getting this
 * wrong shows an amount in the wrong unit, so both the success path and the
 * fallback path are pinned down here — the fallback matters because a token
 * that cannot be read must still render its amounts.
 */

const readContract = vi.hoisted(() => vi.fn());

vi.mock("@/lib/payflow", () => ({
  // payflow-contract#68 not shipped; the two-step transfer stays off.
  mandateSupportsTransfer: () => false,
  mandatePendingTransfer: () => null, readContract }));

const USDC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const EURC = "CDQ5EJTVXXX2CBMHWP3BGGUDHSK6D4I25IF5XXH3QGL2TNTBMJUOFKDB";

/** Answers the two SEP-41 metadata calls, failing for anything unnamed. */
function token(answers: Record<string, unknown>) {
  readContract.mockImplementation(async (_id: string, method: string) => {
    if (!(method in answers)) throw new Error(`no such function: ${method}`);
    return answers[method];
  });
}

beforeEach(async () => {
  readContract.mockReset();
  const { clearTokenMetaCache } = await import("@/lib/token");
  clearTokenMetaCache();
});

describe("loadTokenMeta", () => {
  it("reads symbol and decimals from the token contract", async () => {
    token({ symbol: "USDC", decimals: 6 });
    const { loadTokenMeta } = await import("@/lib/token");

    expect(await loadTokenMeta(USDC, "GREADSOURCE")).toEqual({
      symbol: "USDC",
      decimals: 6,
    });
    expect(readContract).toHaveBeenCalledWith(USDC, "symbol", "GREADSOURCE");
    expect(readContract).toHaveBeenCalledWith(USDC, "decimals", "GREADSOURCE");
  });

  it("caches, so a page listing many plans in one token reads it once", async () => {
    token({ symbol: "USDC", decimals: 6 });
    const { loadTokenMeta } = await import("@/lib/token");

    await loadTokenMeta(USDC);
    await loadTokenMeta(USDC);
    await loadTokenMeta(USDC);

    expect(readContract).toHaveBeenCalledTimes(2); // symbol + decimals, once
  });

  it("caches each token separately", async () => {
    token({ symbol: "USDC", decimals: 6 });
    const { clearTokenMetaCache, loadTokenMeta } = await import("@/lib/token");
    expect(await loadTokenMeta(USDC)).toEqual({ symbol: "USDC", decimals: 6 });

    token({ symbol: "EURC", decimals: 7 });
    clearTokenMetaCache();
    expect(await loadTokenMeta(EURC)).toEqual({ symbol: "EURC", decimals: 7 });
  });

  it("falls back to native XLM when the token cannot be read", async () => {
    // The public demo and any contract without metadata must still show
    // amounts, so a failed read degrades to XLM rather than blanking the page.
    readContract.mockRejectedValue(new Error("host error: missing contract"));
    const { loadTokenMeta } = await import("@/lib/token");

    expect(await loadTokenMeta(USDC)).toEqual(XLM);
  });

  it("degrades each field independently", async () => {
    readContract.mockImplementation(async (_id: string, method: string) => {
      if (method === "symbol") return "USDC";
      throw new Error("no such function: decimals");
    });
    const { loadTokenMeta } = await import("@/lib/token");

    expect(await loadTokenMeta(USDC)).toEqual({ symbol: "USDC", decimals: XLM.decimals });
  });

  it("substitutes the symbol when the token returns an empty one", async () => {
    token({ symbol: "   ", decimals: 6 });
    const { loadTokenMeta } = await import("@/lib/token");

    expect(await loadTokenMeta(USDC)).toEqual({ symbol: "XLM", decimals: 6 });
  });

  it("returns XLM without touching the network for an unconfigured token", async () => {
    const { loadTokenMeta } = await import("@/lib/token");

    expect(await loadTokenMeta("")).toEqual(XLM);
    expect(readContract).not.toHaveBeenCalled();
  });
});

describe("metaFor", () => {
  it("falls back to XLM for a token that has not loaded", async () => {
    const { metaFor } = await import("@/lib/token");

    expect(metaFor(new Map(), USDC)).toEqual(XLM);
    expect(metaFor(new Map(), undefined)).toEqual(XLM);
    expect(metaFor(new Map(), null)).toEqual(XLM);
  });

  it("returns the loaded metadata when it is present", async () => {
    token({ symbol: "USDC", decimals: 6 });
    const { loadTokenMeta, metaFor } = await import("@/lib/token");
    await loadTokenMeta(USDC);

    expect(metaFor(new Map([[USDC, { symbol: "USDC", decimals: 6 }]]), USDC)).toEqual({
      symbol: "USDC",
      decimals: 6,
    });
  });
});