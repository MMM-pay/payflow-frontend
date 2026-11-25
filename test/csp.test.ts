import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyCspToExport, withInlineScriptHashes } from "../scripts/csp.mjs";

const hash = (script: string) =>
  `'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`;

/** The RSC payload Next inlines into every page; it marks a page as exported. */
const FLIGHT = 'self.__next_f.push([1,"1:\\"$Sreact.fragment\\""])';

function page(inline: string[] = ["window.ready = true;"]) {
  return [
    "<!DOCTYPE html><html><head>",
    '<meta name="theme-color" content="#0b0e14">',
    "</head><body>",
    '<script src="/_next/static/chunk.js"></script>',
    ...inline.map((script) => `<script>${script}</script>`),
    `<script>${FLIGHT}</script>`,
    "</body></html>",
  ].join("");
}

/** The policy the exported document declares, or null when it has none. */
function declaredPolicy(html: string): string | null {
  const match = html.match(
    /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/,
  );
  return match?.[1] ?? null;
}

describe("static export CSP", () => {
  it("hashes inline scripts while leaving external scripts to self", () => {
    const html = withInlineScriptHashes(page(["window.ready = true;"]));
    const policy = declaredPolicy(html);

    expect(policy).toContain(`script-src 'self' ${hash("window.ready = true;")}`);
    expect(policy).toContain("connect-src 'self'");
    // External scripts are authorised by 'self', never by a hash of nothing.
    expect(policy).not.toContain(hash(""));
  });

  it("injects the policy into <head> before any script runs", () => {
    const html = withInlineScriptHashes(page());
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(
      html.indexOf("<script"),
    );
  });

  it("leaves every hashed script byte-identical", () => {
    // The flight payload used to contain the policy (and so the hash list)
    // because the root layout rendered it. That made the hash self-referential
    // and the browser blocked the script, breaking hydration on every page.
    const html = withInlineScriptHashes(page());

    expect(html).toContain(`<script>${FLIGHT}</script>`);
    for (const script of ["window.ready = true;", FLIGHT]) {
      expect(declaredPolicy(html)).toContain(hash(script));
    }
  });

  it("rejects HTML that is not a Next export page", () => {
    expect(() => withInlineScriptHashes("<html><head></head></html>")).toThrow(
      "Not a Next.js export page",
    );
  });

  it("stamps exported pages and skips copied fixtures", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "payflow-csp-"));
    await mkdir(path.join(directory, "embed"), { recursive: true });
    await writeFile(path.join(directory, "index.html"), page());
    const fixture = "<!DOCTYPE html><html><head></head><body>demo</body></html>";
    await writeFile(path.join(directory, "embed", "test.html"), fixture);

    await applyCspToExport(directory);

    const stampedHtml = await readFile(path.join(directory, "index.html"), "utf8");
    const policy = declaredPolicy(stampedHtml);
    expect(policy).toContain(hash("window.ready = true;"));
    expect(await readFile(path.join(directory, "embed", "test.html"), "utf8")).toBe(
      fixture,
    );
  });

  it("fails when the export contains no page to stamp", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "payflow-csp-"));
    await writeFile(path.join(directory, "test.html"), "<html><head></head></html>");

    await expect(applyCspToExport(directory)).rejects.toThrow(
      "No Next.js export pages found",
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
