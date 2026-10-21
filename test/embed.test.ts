import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("embed assets and script verification", () => {
  const embedScriptPath = resolve(__dirname, "../embed/payflow-embed.js");
  const testHtmlPath = resolve(__dirname, "../embed/test.html");
  const readmePath = resolve(__dirname, "../embed/README.md");

  it("embed files exist in embed/ directory", () => {
    expect(existsSync(embedScriptPath)).toBe(true);
    expect(existsSync(testHtmlPath)).toBe(true);
    expect(existsSync(readmePath)).toBe(true);
  });

  it("embed script has no third-party tracking or analytics", () => {
    const scriptContent = readFileSync(embedScriptPath, "utf8");

    // Check for common tracking scripts/services
    expect(scriptContent).not.toMatch(/google-analytics\.com/i);
    expect(scriptContent).not.toMatch(/googletagmanager\.com/i);
    expect(scriptContent).not.toMatch(/mixpanel/i);
    expect(scriptContent).not.toMatch(/segment\.io/i);
    expect(scriptContent).not.toMatch(/facebook\.net/i);
    expect(scriptContent).not.toMatch(/hotjar/i);
    expect(scriptContent).not.toMatch(/sentry/i);

    // Verify self-contained custom element definition
    expect(scriptContent).toContain("customElements.define('payflow-button'");
    expect(scriptContent).toContain("openSubscribePopup");
  });

  it("test.html is a valid plain HTML page referencing payflow-embed.js", () => {
    const html = readFileSync(testHtmlPath, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("payflow-embed.js");
    expect(html).toContain("<payflow-button");
    expect(html).toContain("plan-id");
  });

  it("README.md documents the snippet and attributes", () => {
    const doc = readFileSync(readmePath, "utf8");
    expect(doc).toContain("<payflow-button");
    expect(doc).toContain("plan-id");
    expect(doc).toContain("merchant");
  });
});
