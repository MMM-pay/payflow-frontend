import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCspToExport, withInlineScriptHashes } from "../scripts/apply-csp.mjs";

describe("static export CSP", () => {
  it("hashes inline scripts while leaving external scripts to self", () => {
    const inlineScript = "window.ready = true;";
    const html = [
      '<meta http-equiv="Content-Security-Policy" content="script-src \'self\' __PAYFLOW_SCRIPT_HASHES__">',
      '<script src="/_next/static/chunk.js"></script>',
      `<script>${inlineScript}</script>`,
    ].join("");
    const digest = createHash("sha256").update(inlineScript).digest("base64");

    expect(withInlineScriptHashes(html)).toBe(
      html.replace("__PAYFLOW_SCRIPT_HASHES__", `'sha256-${digest}'`),
    );
  });

  it("fails if an exported page is missing the CSP marker", () => {
    expect(() => withInlineScriptHashes("<html></html>")).toThrow(
      "CSP hash marker was not found in exported HTML.",
    );
  });

  it("skips stamping when the build deliberately disables the CSP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "payflow-csp-"));
    const html = "<html><head></head><body><script>window.ready = true;</script></body></html>";
    const file = join(directory, "index.html");
    await writeFile(file, html);
    const previous = process.env.NEXT_PUBLIC_DISABLE_CSP;
    process.env.NEXT_PUBLIC_DISABLE_CSP = "1";

    try {
      await applyCspToExport(directory);
      expect(await readFile(file, "utf8")).toBe(html);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_DISABLE_CSP;
      else process.env.NEXT_PUBLIC_DISABLE_CSP = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });
});