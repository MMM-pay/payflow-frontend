import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withInlineScriptHashes } from "../scripts/apply-csp.mjs";

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
});