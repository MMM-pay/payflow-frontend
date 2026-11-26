import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCspToExport, withCsp } from "../scripts/apply-csp.mjs";

function digest(contents: string) {
  return createHash("sha256").update(contents, "utf8").digest("base64");
}

function cspFrom(html: string) {
  const match = html.match(
    /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/,
  );
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

describe("static export CSP", () => {
  it("hashes inline scripts and injects the policy before them", () => {
    const inlineScript = "window.ready = true;";
    const html = [
      "<html><head>",
      '<script src="/_next/static/chunk.js"></script>',
      `<script>${inlineScript}</script>`,
      "</head><body></body></html>",
    ].join("");

    const result = withCsp(html);
    const policy = cspFrom(result);

    expect(policy).toContain(`'sha256-${digest(inlineScript)}'`);
    expect(policy).toContain("script-src 'self'");
    expect(result).toContain(`<script>${inlineScript}</script>`);
    expect(result.indexOf("Content-Security-Policy")).toBeLessThan(
      result.indexOf("<script"),
    );
  });

  it("does not rewrite the RSC payload that mentions the policy", () => {
    const flightScript =
      'self.__next_f.push([1,"policy: script-src \'self\' __PAYFLOW_SCRIPT_HASHES__"])';
    const html = `<html><head><script>${flightScript}</script></head><body></body></html>`;

    const result = withCsp(html);

    expect(result).toContain(flightScript);
    expect(cspFrom(result)).toContain(`'sha256-${digest(flightScript)}'`);
  });

  it("replaces an existing policy instead of adding a second one", () => {
    const html = [
      "<html><head>",
      '<meta http-equiv="Content-Security-Policy" content="old-policy">',
      "<script>1</script>",
      "</head><body></body></html>",
    ].join("");

    const result = withCsp(html);

    expect(result.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(result).not.toContain("old-policy");
    expect(cspFrom(result)).toContain(`'sha256-${digest("1")}'`);
  });

  it("fails if the document has no head", () => {
    expect(() => withCsp("<html></html>")).toThrow(
      "Exported HTML is missing a <head> element.",
    );
  });

  it("skips hash injection when CSP is disabled for a test build", async () => {
    const previous = process.env.NEXT_PUBLIC_DISABLE_CSP;
    process.env.NEXT_PUBLIC_DISABLE_CSP = "1";
    try {
      await expect(applyCspToExport("/nonexistent-test-export")).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_DISABLE_CSP;
      else process.env.NEXT_PUBLIC_DISABLE_CSP = previous;
    }
  });
});
