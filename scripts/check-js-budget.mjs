/**
 * First-load JS budget check.
 *
 * `next build` prints per-route sizes, but nothing enforces them: a route can
 * quietly grow by importing a heavy module into its static graph (the Stellar
 * SDK and wallet kit together are over 1 MB raw) and CI stays green. This
 * script measures what the browser actually downloads for first paint of each
 * exported route — the gzip total of every `<script src>` the route's HTML
 * references — and fails when a route exceeds its budget in `js-budget.json`.
 *
 * Run it against the static export: `npm run build && npm run budget`.
 *
 * The numbers are our own gzip measurement of `out/`, not Next's printed
 * table. They run a little higher (polyfills and runtime included) but are
 * perfectly comparable between runs, which is what a regression budget needs.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "out");
const BUDGET_FILE = join(ROOT, "js-budget.json");

/** The `src` of every external script an HTML document must load, deduped. */
export function scriptSources(html) {
  const found = [];
  const re = /<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const src = m[1];
    if (src.endsWith(".js")) found.push(src);
  }
  return [...new Set(found)];
}

/**
 * Where a script URL lives inside `out/`. Assets may carry a basePath prefix
 * (`/payflow-frontend/_next/...` on the GitHub Pages deployment), so the path
 * is taken from the `/_next/` marker rather than the string's start.
 */
export function assetFile(src) {
  // Route segments are URL-encoded in the HTML (`plans/%5Bid%5D`), and the
  // file on disk is not.
  const url = decodeURIComponent(src);
  const marker = "/_next/";
  const at = url.lastIndexOf(marker);
  return at === -1 ? url.replace(/^\/+/, "") : url.slice(at + 1);
}

/**
 * The budget for a route: an exact match wins, then the longest configured
 * prefix that ends at a path boundary (`/plans` covers `/plans/4`), then the
 * `default`. Returns null when the route has no budget at all.
 */
export function budgetFor(route, budgets) {
  if (Object.hasOwn(budgets.routes ?? {}, route)) return budgets.routes[route];
  let best = null;
  for (const [prefix, kb] of Object.entries(budgets.routes ?? {})) {
    // A prefix matches its own route and everything under it at a path
    // boundary. "/" is special: it means the root route only, not every route.
    const matches =
      prefix === "/"
        ? route === "/"
        : route.startsWith(prefix.endsWith("/") ? prefix : prefix + "/");
    if (!matches) continue;
    if (best === null || prefix.length > best.prefix.length) best = { prefix, kb };
  }
  if (best) return best.kb;
  return budgets.default ?? null;
}

/** Compare measured routes against the budget map. Pure: bytes in, verdicts out. */
export function checkRoutes(measurements, budgets) {
  return measurements.map(({ route, bytes }) => {
    const kb = budgetFor(route, budgets);
    return {
      route,
      kilobytes: bytes / 1024,
      budgetKilobytes: kb,
      // `kb === null` (no budget configured) passes but is reported.
      ok: kb === null || bytes <= kb * 1024,
    };
  });
}

/** Every `index.html` the static export produced, as [route, file] pairs. */
function exportedRoutes(outDir) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_next") walk(path);
      } else if (entry.name === "index.html") {
        const rel = relative(outDir, dirname(path));
        found.push([rel ? `/${rel}` : "/", path]);
      }
    }
  };
  walk(outDir);
  return found.sort(([a], [b]) => a.localeCompare(b));
}

function main() {
  if (!existsSync(OUT_DIR)) {
    console.error("out/ not found. Run `npm run build` first — this checks the static export.");
    process.exit(2);
  }
  const budgets = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
  const measurements = exportedRoutes(OUT_DIR).map(([route, file]) => {
    const html = readFileSync(file, "utf8");
    const bytes = scriptSources(html).reduce((sum, src) => {
      const file = join(OUT_DIR, assetFile(src));
      if (!existsSync(file)) {
        console.error(`${route} references a script missing from out/: ${src}`);
        process.exit(2);
      }
      return sum + gzipSync(readFileSync(file)).length;
    }, 0);
    return { route, bytes };
  });

  const results = checkRoutes(measurements, budgets);
  const width = Math.max(...results.map((r) => r.route.length), 5);
  console.log(`${"Route".padEnd(width)}  First-load JS  Budget`);
  for (const r of results) {
    const size = `${r.kilobytes.toFixed(1)} kB`;
    const budget = r.budgetKilobytes === null ? "—" : `${r.budgetKilobytes} kB`;
    console.log(`${r.route.padEnd(width)}  ${size.padStart(12)}  ${budget.padStart(6)}  ${r.ok ? "" : "OVER BUDGET"}`);
  }

  const over = results.filter((r) => !r.ok);
  if (over.length > 0) {
    console.error(
      `\n${over.length} route(s) exceed the first-load JS budget: ` +
        over.map((r) => `${r.route} (${r.kilobytes.toFixed(1)} kB > ${r.budgetKilobytes} kB)`).join(", ") +
        "\nEither trim the route's static import graph (the Stellar SDK and the\n" +
        "wallet kit must load on demand) or, if the growth is intentional,\n" +
        "raise the budget in js-budget.json in the same PR.",
    );
    process.exit(1);
  }
  console.log("\nAll routes are within the first-load JS budget.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
