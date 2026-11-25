import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CSP_MARKER = "__PAYFLOW_SCRIPT_HASHES__";

export function withInlineScriptHashes(html) {
  const hashes = new Set();
  const scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

  for (const match of html.matchAll(scriptTag)) {
    const attributes = match[1] ?? "";
    const contents = match[2] ?? "";
    if (/\bsrc\s*=/i.test(attributes) || !contents.trim()) continue;
    const digest = createHash("sha256").update(contents, "utf8").digest("base64");
    hashes.add(`'sha256-${digest}'`);
  }

  if (!html.includes(CSP_MARKER)) {
    throw new Error("CSP hash marker was not found in exported HTML.");
  }

  return html.replaceAll(CSP_MARKER, [...hashes].join(" "));
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
  // through the root layout, so they carry no marker; skip those. If nothing
  // carries the marker, the layout lost its CSP tag and the build must fail.
  let stamped = 0;
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    if (!html.includes(CSP_MARKER)) continue;
    await writeFile(file, withInlineScriptHashes(html));
    stamped += 1;
  }
  if (stamped === 0) {
    throw new Error("CSP hash marker was not found in exported HTML.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await applyCspToExport();
}
