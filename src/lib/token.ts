"use client";

import { useEffect, useMemo, useState } from "react";
import { config } from "./config";
import { loadPayflow } from "./lazy-payflow";
import { XLM, type TokenMeta } from "./format";

/**
 * Token symbol and decimals, read from the token contract itself.
 *
 * A plan's price is denominated in whatever token the plan names, and a token
 * contract chooses its own decimals — SEP-41 allows any `u32`. Assuming 7 and
 * labelling everything "XLM" misprices a plan in any other token by a factor of
 * 10^7, so the metadata is read rather than guessed.
 *
 * The contract is the source of truth here even when the indexer is configured,
 * because `symbol()` and `decimals()` are cheap simulation reads and the API
 * does not serve them. Everything therefore works in contract-only mode too.
 */

/** Module-level cache: token metadata is global, so one read serves the app. */
const cache = new Map<string, TokenMeta>();

/** Exported for tests. */
export function clearTokenMetaCache(): void {
  cache.clear();
}

/**
 * A token contract that is not configured, not a valid contract id, or whose
 * metadata call fails yields the native fallback rather than throwing: the
 * amount is still worth showing, just with a possibly wrong unit.
 */
function normalise(symbol: unknown, decimals: unknown): TokenMeta {
  const sym = typeof symbol === "string" ? symbol.trim() : "";
  const dec = typeof decimals === "number" ? decimals : Number(decimals);
  return {
    symbol: sym || XLM.symbol,
    decimals: Number.isFinite(dec) ? dec : XLM.decimals,
  };
}

/** Reads `symbol()` and `decimals()` from a SEP-41 token, caching the result. */
export async function loadTokenMeta(
  token: string,
  source: string = config.readSource,
): Promise<TokenMeta> {
  if (!token) return XLM;
  const hit = cache.get(token);
  if (hit) return hit;

  let meta: TokenMeta;
  try {
    // Settled rather than all: a token that answers only one of the two still
    // gets that half right instead of losing both.
    const { readContract } = await loadPayflow();
    const [symbol, decimals] = await Promise.allSettled([
      readContract<string>(token, "symbol", source),
      readContract<number>(token, "decimals", source),
    ]);
    meta = normalise(
      symbol.status === "fulfilled" ? symbol.value : undefined,
      decimals.status === "fulfilled" ? decimals.value : undefined,
    );
  } catch {
    // An older token contract, or one that failed to answer. Showing the amount
    // with the wrong unit beats hiding every amount on the page.
    meta = XLM;
  }

  cache.set(token, meta);
  return meta;
}

/** The metadata for `token`, defaulting to native XLM when it is not loaded. */
export function metaFor(
  metas: Map<string, TokenMeta>,
  token: string | undefined | null,
): TokenMeta {
  return (token && metas.get(token)) || XLM;
}

/**
 * Loads the metadata for every distinct token in `tokens` and returns them
 * keyed by contract id. Takes a list because a page can hold plans in several
 * tokens at once, and the resolver for one would break the rules of hooks.
 *
 * Unresolvable tokens are absent from the map; `metaFor` turns that back into
 * the native fallback.
 */
export function useTokenMetas(tokens: readonly string[]): Map<string, TokenMeta> {
  // Joining gives a stable primitive dep even though callers pass a fresh
  // array on every render.
  const key = [...new Set(tokens.filter(Boolean))].sort().join(",");
  const [metas, setMetas] = useState<Map<string, TokenMeta>>(
    () => new Map(cache),
  );

  useEffect(() => {
    const wanted = key ? key.split(",") : [];
    const missing = wanted.filter((t) => !cache.has(t));
    if (missing.length === 0) {
      // Already known. Keep the previous Map identity so this cannot loop.
      setMetas((prev) => (prev.size === cache.size ? prev : new Map(cache)));
      return;
    }

    let live = true;
    // Merge what each token resolved to rather than reading the cache back:
    // the map is then correct even if the read never reached the cache.
    void Promise.all(
      missing.map(async (t) => [t, await loadTokenMeta(t)] as const),
    ).then((pairs) => {
      if (!live) return;
      setMetas((prev) => {
        const next = new Map(prev);
        for (const [token, meta] of pairs) next.set(token, meta);
        return next.size === prev.size ? prev : next;
      });
    });
    return () => {
      live = false;
    };
  }, [key]);

  return metas;
}

/** `useTokenMetas` for a page that only ever deals in one token. */
export function useTokenMeta(token: string | undefined | null): TokenMeta {
  const list = useMemo(() => (token ? [token] : []), [token]);
  return metaFor(useTokenMetas(list), token);
}