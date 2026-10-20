"use client";

import { useEffect, useState } from "react";
import { config } from "./config";

/**
 * Merchant display names, read from what the merchant itself publishes.
 *
 * Merchants appear across the app as raw `G…` addresses, which tells a
 * subscriber nothing about who they pay. Every Stellar account can publish a
 * `home_domain`, and that domain can serve a `stellar.toml` with an `ORG_NAME`
 * (SEP-1). That is the only name source available without a backend, so it
 * works in contract-only mode; it is *self-declared* — the protocol cannot
 * verify it — and the UI must say so rather than implying endorsement.
 *
 * Everything here fails quietly. A missing Horizon account, an empty home
 * domain, a 404, a toml without ORG_NAME, or a network error all resolve to
 * `null` so a display name can never break a page that is otherwise correct,
 * and misses are cached so a flapping network cannot hammer Horizon.
 */

/** How long one stellar.toml fetch may take before it is given up on. */
const TOML_TIMEOUT_MS = 5_000;

/**
 * Address -> published name. `null` is a cached miss: the account has no
 * readable name and must not be re-fetched on every render.
 */
const cache = new Map<string, string | null>();

/** Exported for tests. */
export function clearTomlCache(): void {
  cache.clear();
}

/**
 * The `ORG_NAME` from a stellar.toml, or `null`. Minimal top-level TOML
 * reader: keys inside `[GENERAL]` (the default section) and at file level are
 * considered; everything else belongs to another document's identity. A real
 * TOML library would weigh more than this one field is worth.
 */
export function orgNameFromToml(toml: string): string | null {
  let section = "";
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header?.[1]) {
      section = header[1].trim().toUpperCase();
      continue;
    }
    if (section !== "" && section !== "GENERAL") continue;
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line);
    if (kv?.[1] && kv[1].toUpperCase() === "ORG_NAME") {
      const name = (kv[2] ?? "").trim();
      return name || null;
    }
  }
  return null;
}

/**
 * The account's `home_domain` as published on Horizon. Throws on a missing
 * account or unreachable Horizon; callers decide what that means.
 */
export async function fetchHomeDomain(address: string): Promise<string> {
  if (!config.horizonUrl) {
    throw new Error("Horizon URL is not configured.");
  }
  const res = await fetch(`${config.horizonUrl}/accounts/${address}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Horizon responded ${res.status}`);
  const data = (await res.json()) as { home_domain?: unknown };
  return typeof data.home_domain === "string" ? data.home_domain.trim() : "";
}

/** Default stellar.toml reader: one timed GET, `null` on any failure. */
async function fetchToml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(TOML_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Injection points so tests never touch Horizon or the network. */
export interface OrgNameDeps {
  /** Resolves an account's home domain; defaults to Horizon. */
  homeDomain?: (address: string) => Promise<string>;
  /** Fetches a stellar.toml; defaults to a timed GET of /.well-known/. */
  toml?: (url: string) => Promise<string | null>;
}

/**
 * The merchant's self-declared `ORG_NAME`, or `null` when it cannot be
 * known. Makes no request at all when the account publishes no home domain,
 * and caches both hits and misses per address.
 */
export async function loadOrgName(
  address: string,
  deps: OrgNameDeps = {},
): Promise<string | null> {
  if (!address) return null;
  const cached = cache.get(address);
  if (cached !== undefined) return cached;

  const readHomeDomain = deps.homeDomain ?? fetchHomeDomain;
  const readToml = deps.toml ?? fetchToml;

  let name: string | null = null;
  try {
    // A home domain is a bare host; tolerate a stray scheme or path.
    const domain = (await readHomeDomain(address))
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
    if (domain) {
      const toml = await readToml(`https://${domain}/.well-known/stellar.toml`);
      name = toml ? orgNameFromToml(toml) : null;
    }
  } catch {
    // Horizon down, account missing, domain dead: a name is a nicety, and
    // the address itself is always shown beside it.
    name = null;
  }

  cache.set(address, name);
  return name;
}

/**
 * `loadOrgName` for components. Returns the cached name immediately when the
 * address has been resolved before, then upgrades to `null` or the name.
 */
export function useOrgName(address: string | null | undefined): string | null {
  const [name, setName] = useState<string | null>(
    () => (address && cache.get(address)) || null,
  );

  useEffect(() => {
    if (!address) {
      setName(null);
      return;
    }
    let live = true;
    void loadOrgName(address).then((resolved) => {
      if (live) setName(resolved);
    });
    return () => {
      live = false;
    };
  }, [address]);

  return name;
}
