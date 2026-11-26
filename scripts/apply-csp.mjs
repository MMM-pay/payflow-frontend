import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 * Build the policy that apply-csp injects into every exported page.
 *
 * Kept in this build-time script rather than the React layout: the App Router
 * serialises the layout into the inline RSC payload, so a policy rendered
 * there would contain the list of script hashes that are computed from that
 * same payload. Hashing the payload and then rewriting the hash list inside it
 * invalidates the hash. Injecting the meta tag after the export breaks the
 * cycle and leaves the payload untouched.
 */
export function buildCspContent(scriptHashes) {
  const connectSources = [
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
    process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
    process.env.NEXT_PUBLIC_API_URL === undefined
      ? "http://localhost:8080"
      : process.env.NEXT_PUBLIC_API_URL,
    ...(process.env.NEXT_PUBLIC_STELLAR_TOML_ORIGINS ?? "").split(","),
    "https://relay.walletconnect.com",
    "wss://relay.walletconnect.com",
    "https://api.web3modal.org",
    "https://pulse.walletconnect.com",
  ]
    .map(httpOrigin)
    .filter(Boolean);

  const extraSources = (process.env.NEXT_PUBLIC_CSP_CONNECT_SRC ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const isDevelopment = process.env.NODE_ENV === "development";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https://*.walletconnect.com https://*.walletconnect.org",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${isDevelopment ? "ws://localhost:3000" : ""} ${[
      ...new Set([...connectSources, ...extraSources]),
    ].join(" ")}`,
    "frame-src 'self' https://verify.walletconnect.com",
    `script-src 'self' ${isDevelopment ? "'unsafe-eval'" : ""} ${scriptHashes.join(" ")}`,
  ].join("; ");
}

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const CSP_META_TAG = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i;

/**
 * Hash every inline script in an exported page and inject a matching CSP meta
 * tag at the start of `<head>`.
 *
 * The script contents are never rewritten, so a page whose RSC payload happens
 * to mention the policy still hashes the exact bytes the browser executes.
 */
export function withCsp(html) {
  const head = /<head\b[^>]*>/i.exec(html);
  if (!head) {
    throw new Error("Exported HTML is missing a <head> element.");
  }

  const hashes = new Set();
  for (const match of html.matchAll(SCRIPT_TAG)) {
    const attributes = match[1] ?? "";
    const contents = match[2] ?? "";
    if (/\bsrc\s*=/i.test(attributes) || !contents.trim()) continue;
    const digest = createHash("sha256").update(contents, "utf8").digest("base64");
    hashes.add(`'sha256-${digest}'`);
  }

  const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCspContent([
    ...hashes,
  ])}">`;

  if (CSP_META_TAG.test(html)) return html.replace(CSP_META_TAG, meta);

  const index = head.index + head[0].length;
  return html.slice(0, index) + meta + html.slice(index);
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

  // Plain static fixtures copied into the export (embed/test.html) are not
  // rendered through the root layout and carry their own inline handlers, so
  // they must not receive the app's policy. Every Next page references its
  // build under `/_next/`.
  let stamped = 0;
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    if (!html.includes("/_next/")) continue;
    await writeFile(file, withCsp(html));
    stamped += 1;
  }
  if (stamped === 0) {
    throw new Error("No Next.js exported pages were found to stamp with CSP.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await applyCspToExport();
}
