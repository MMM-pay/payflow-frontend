import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Content-Security-Policy for the static export.
 *
 * The policy is injected into each exported page *after* the build rather than
 * rendered by the root layout. Next.js embeds the whole `<head>` in the RSC
 * flight payload, which is itself an inline script: a policy rendered there
 * would contain the hash list that authorises the script containing it, so the
 * hash could never match. Injecting the `<meta>` afterwards keeps the script
 * bodies final before they are hashed.
 */

/** Every page Next exports carries the flight payload; copied fixtures do not. */
const NEXT_PAGE_MARKER = "self.__next_f";

const HEAD_TAG = /<head(\s[^>]*)?>/i;
const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** Allow only the origin of a URL, dropping anything unparsable. */
function httpOrigin(value) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:", "ws:", "wss:"].includes(url.protocol)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

/**
 * Origins the app may connect to. Deriving them here (rather than only in
 * `next.config.mjs`) lets the post-export step compute the same policy in its
 * own process, where the build's inlined env is no longer set.
 */
export function cspConnectSources() {
  const sources = [
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
    process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
    process.env.NEXT_PUBLIC_API_URL === undefined
      ? "http://localhost:8080"
      : process.env.NEXT_PUBLIC_API_URL,
    ...(process.env.NEXT_PUBLIC_STELLAR_TOML_ORIGINS ?? "").split(","),
    ...(process.env.NEXT_PUBLIC_CSP_CONNECT_SRC ?? "").split(/\s+/),
    "https://relay.walletconnect.com",
    "wss://relay.walletconnect.com",
    "https://api.web3modal.org",
    "https://pulse.walletconnect.com",
  ]
    .map(httpOrigin)
    .filter(Boolean);
  return [...new Set(sources)];
}

/** The directive list, with the inline-script hashes as its only variable. */
export function cspPolicy(hashes) {
  const scriptSources = ["'self'", ...hashes].join(" ");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https://*.walletconnect.com https://*.walletconnect.org",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${cspConnectSources().join(" ")}`.trimEnd(),
    "frame-src 'self' https://verify.walletconnect.com",
    `script-src ${scriptSources}`,
  ].join("; ");
}

/** Base64 SHA-256 of every inline script, the form a `script-src` hash takes. */
export function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const attributes = match[1] ?? "";
    const contents = match[2] ?? "";
    // External scripts are covered by 'self'; empty tags have nothing to run.
    if (/\bsrc\s*=/i.test(attributes) || !contents.trim()) continue;
    const digest = createHash("sha256").update(contents, "utf8").digest("base64");
    hashes.add(`'sha256-${digest}'`);
  }
  return [...hashes];
}

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Hash every inline script and inject the policy that allows exactly those
 * scripts. Throws for HTML that is not a Next.js page, so a copied fixture is
 * never stamped with a policy that has nothing to do with it.
 */
export function withInlineScriptHashes(html) {
  if (!html.includes(NEXT_PAGE_MARKER)) {
    throw new Error("Not a Next.js export page: no flight payload to hash.");
  }
  if (!HEAD_TAG.test(html)) {
    throw new Error("Exported page has no <head> tag to carry the policy.");
  }
  // The meta tag is inserted after the hashes are taken: it is the only thing
  // this function adds, and it contains the list, so hashing first matters.
  const meta =
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(cspPolicy(inlineScriptHashes(html)))}">`;
  return html.replace(HEAD_TAG, (tag) => `${tag}${meta}`);
}

async function visitHtml(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await visitHtml(fullPath)));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(fullPath);
  }
  return files;
}

export async function applyCspToExport(directory = "out") {
  if (process.env.NEXT_PUBLIC_DISABLE_CSP === "1") {
    console.info("[csp] disabled for this build; skipping hash injection");
    return;
  }

  const htmlFiles = await visitHtml(directory);
  if (htmlFiles.length === 0) {
    throw new Error(`No exported HTML files found in ${directory}.`);
  }

  // Static fixtures copied into the export (embed/test.html) are not rendered
  // through Next, so they carry no flight payload and are skipped. If nothing
  // is a Next page, the export itself is wrong and the build must fail.
  let stamped = 0;
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    if (!html.includes(NEXT_PAGE_MARKER)) continue;
    await writeFile(file, withInlineScriptHashes(html));
    stamped += 1;
  }
  if (stamped === 0) {
    throw new Error("No Next.js export pages found to apply the CSP to.");
  }
}
