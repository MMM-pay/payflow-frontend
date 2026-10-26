import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assetFile,
  budgetFor,
  checkRoutes,
  scriptSources,
} from "../scripts/check-js-budget.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("scriptSources", () => {
  it("lists each external script once, ignoring inline scripts", () => {
    const html = `
      <script>window.__payload = 1</script>
      <script src="/_next/static/chunks/a.js" async=""></script>
      <script defer="" src="/_next/static/chunks/b.js"></script>
      <script src="/_next/static/chunks/a.js"></script>
      <link rel="modulepreload" href="/_next/static/chunks/c.js">
    `;
    expect(scriptSources(html)).toEqual([
      "/_next/static/chunks/a.js",
      "/_next/static/chunks/b.js",
    ]);
  });

  it("returns nothing for a page with no external scripts", () => {
    expect(scriptSources("<!doctype html><p>hello</p>")).toEqual([]);
  });
});

describe("assetFile", () => {
  it("resolves a root-relative asset", () => {
    expect(assetFile("/_next/static/chunks/a.js")).toBe("_next/static/chunks/a.js");
  });

  it("resolves an asset under the GitHub Pages base path", () => {
    expect(assetFile("/payflow-frontend/_next/static/chunks/a.js")).toBe(
      "_next/static/chunks/a.js",
    );
  });

  it("decodes URL-encoded route segments", () => {
    expect(assetFile("/_next/static/chunks/app/plans/%5Bid%5D/page.js")).toBe(
      "_next/static/chunks/app/plans/[id]/page.js",
    );
  });
});

describe("budgetFor", () => {
  const budgets = {
    default: 100,
    routes: { "/": 120, "/account": 130, "/plans": 140 },
  };

  it("prefers an exact match", () => {
    expect(budgetFor("/account", budgets)).toBe(130);
  });

  it("falls back to the longest prefix at a path boundary", () => {
    expect(budgetFor("/plans/4", budgets)).toBe(140);
    expect(budgetFor("/account/history", budgets)).toBe(130);
  });

  it("uses the default when no route matches", () => {
    expect(budgetFor("/404", budgets)).toBe(100);
  });

  it("returns null when there is no budget at all", () => {
    expect(budgetFor("/account", { routes: {} })).toBeNull();
  });

  it("does not treat a longer route name as a prefix match", () => {
    // "/accountancy" must not inherit /account's budget.
    expect(budgetFor("/accountancy", budgets)).toBe(100);
  });
});

describe("checkRoutes", () => {
  it("flags only the routes that exceed their budget", () => {
    const results = checkRoutes(
      [
        { route: "/", bytes: 50 * 1024 },
        { route: "/account", bytes: 200 * 1024 },
      ],
      { default: 100, routes: { "/account": 150 } },
    );
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    expect(results[1]?.budgetKilobytes).toBe(150);
  });

  it("passes a route with no budget but reports it", () => {
    const [only] = checkRoutes([{ route: "/unknown", bytes: 900 * 1024 }], {
      default: undefined,
      routes: {},
    });
    expect(only?.ok).toBe(true);
    expect(only?.budgetKilobytes).toBeNull();
  });
});

/**
 * The bundle budget is enforced in CI by scripts/check-js-budget.mjs, but it
 * only runs after a full build. This guard catches the same regressions at
 * `npm test` speed: the Stellar SDK (~570 kB raw) and the wallet kit (~470 kB)
 * may only be pulled in on demand, and only by the modules allowed to.
 */
describe("static import graph", () => {
  const SRC = join(ROOT, "src");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  /** Specifiers of static (erased-able-free) `import … from "…"` statements. */
  function staticImports(source: string): string[] {
    return [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gm)].map(
      (m) => m[1] as string,
    );
  }

  it("keeps the heavy SDK and wallet kit out of every module but the contract layer", () => {
    // payflow.ts supplies the RPC implementation and bindings.ts the typed
    // argument encoders: they are the SDK-bound contract layer. Everything
    // else must load them (or the kit) dynamically.
    const allowed = new Set([
      join(SRC, "lib", "payflow.ts"),
      join(SRC, "lib", "bindings.ts"),
    ]);
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (allowed.has(file)) continue;
      for (const specifier of staticImports(readFileSync(file, "utf8"))) {
        if (
          specifier === "@stellar/stellar-sdk" ||
          specifier === "@creit.tech/stellar-wallets-kit"
        ) {
          offenders.push(`${file} statically imports ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the SDK-bound payflow module out of every static import graph", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file === join(SRC, "lib", "payflow.ts")) continue;
      for (const specifier of staticImports(readFileSync(file, "utf8"))) {
        if (
          specifier === "@/lib/payflow" ||
          specifier === "./payflow" ||
          specifier === "../payflow"
        ) {
          offenders.push(`${file} statically imports ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
