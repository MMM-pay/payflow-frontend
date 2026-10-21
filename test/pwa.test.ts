import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("PWA Installability & Configuration", () => {
  it("includes a valid W3C web app manifest with standalone display and required icons", () => {
    const manifestPath = path.join(process.cwd(), "public", "manifest.webmanifest");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(content.name).toBe("Payflow");
    expect(content.short_name).toBe("Payflow");
    expect(content.display).toBe("standalone");
    expect(content.start_url).toBe("./");
    expect(content.background_color).toBeTruthy();
    expect(content.theme_color).toBeTruthy();

    expect(Array.isArray(content.icons)).toBe(true);
    const sizes = content.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");

    // Icons exist on disk
    expect(fs.existsSync(path.join(process.cwd(), "public", "icon-192.png"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "public", "icon-512.png"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "public", "icon-maskable-192.png"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "public", "icon-maskable-512.png"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "public", "icon.svg"))).toBe(true);
  });

  it("service worker never caches Soroban RPC, Horizon, or API requests", () => {
    const swPath = path.join(process.cwd(), "public", "sw.js");
    expect(fs.existsSync(swPath)).toBe(true);

    const swCode = fs.readFileSync(swPath, "utf8");

    // Verifies strict cache bypassing logic
    expect(swCode).toContain("/rpc");
    expect(swCode).toContain("/soroban");
    expect(swCode).toContain("/horizon");
    expect(swCode).toContain("/api");

    // Verifies only GET requests are candidate for cache
    expect(swCode).toContain('request.method !== "GET"');

    // Verifies cross-origin requests (e.g. testnet Soroban RPC, Horizon) are never cached
    expect(swCode).toContain("url.origin !== self.location.origin");
  });
});
