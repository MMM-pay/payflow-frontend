import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  metadataBase,
  ogImageUrl,
  PAGES,
  pageMetadata,
  type PageDefinition,
} from "@/lib/metadata";

/**
 * The metadata carries the addresses a crawler follows: the canonical link,
 * the Open Graph image and the share target. The site is served from
 * `/payflow-frontend` on GitHub Pages, so a URL that loses the base path is a
 * 404 in the preview and a duplicate in search results.
 */

const page = (over: Partial<PageDefinition> = {}): PageDefinition => ({
  title: "Subscribe to a plan",
  description: "Browse the plans published on Payflow.",
  path: "/subscribe/",
  image: "subscribe",
  ...over,
});

describe("absoluteUrl", () => {
  it("keeps the base path in front of the path", () => {
    expect(absoluteUrl("/subscribe/", "https://mmm-pay.github.io", "/payflow-frontend")).toBe(
      "https://mmm-pay.github.io/payflow-frontend/subscribe/",
    );
  });

  it("works without a base path", () => {
    expect(absoluteUrl("/subscribe/", "https://example.com", "")).toBe(
      "https://example.com/subscribe/",
    );
  });

  it("does not double up the slashes", () => {
    expect(absoluteUrl("subscribe/", "https://example.com/", "/app/")).toBe(
      "https://example.com/app/subscribe/",
    );
  });
});

describe("metadataBase", () => {
  it("keeps the base path so relative URLs stay inside it", () => {
    expect(metadataBase("https://mmm-pay.github.io", "/payflow-frontend").href).toBe(
      "https://mmm-pay.github.io/payflow-frontend/",
    );
  });

  it("resolves a relative path against the base path, not the domain root", () => {
    const base = metadataBase("https://mmm-pay.github.io", "/payflow-frontend");
    expect(new URL("og/home.png", base).href).toBe(
      "https://mmm-pay.github.io/payflow-frontend/og/home.png",
    );
  });
});

describe("ogImageUrl", () => {
  it("points at the image of the page", () => {
    expect(ogImageUrl(page(), "https://mmm-pay.github.io", "/payflow-frontend")).toBe(
      "https://mmm-pay.github.io/payflow-frontend/og/subscribe.png",
    );
  });
});

describe("pageMetadata", () => {
  it("describes the page for search and for a shared link", () => {
    const meta = pageMetadata(page());
    expect(meta.title).toBe("Subscribe to a plan");
    expect(meta.description).toBe("Browse the plans published on Payflow.");
    expect(meta.alternates?.canonical).toBe(
      `${absoluteUrl("/subscribe/")}`,
    );
    expect(meta.openGraph).toMatchObject({
      type: "website",
      siteName: "Payflow",
      title: "Subscribe to a plan",
      url: absoluteUrl("/subscribe/"),
    });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("gives every page an absolute social image", () => {
    const meta = pageMetadata(page());
    const images = meta.openGraph?.images as Array<{ url: string; width: number; height: number }>;
    expect(images[0]?.url).toBe(absoluteUrl("/og/subscribe.png"));
    expect(images[0]?.width).toBe(1200);
    expect(images[0]?.height).toBe(630);
  });

  it("can opt out of the title template", () => {
    expect(pageMetadata(page({ title: "Payflow" }), { absoluteTitle: true }).title).toEqual({
      absolute: "Payflow",
    });
  });

  it("can point the canonical link at a different path", () => {
    const meta = pageMetadata(page({ path: "/plans/" }), { path: "/plans/7/" });
    expect(meta.alternates?.canonical).toBe(absoluteUrl("/plans/7/"));
    expect(meta.openGraph?.url).toBe(absoluteUrl("/plans/7/"));
  });
});

describe("the page list", () => {
  it("covers every route of the app", () => {
    expect(Object.keys(PAGES).sort()).toEqual([
      "account",
      "catalogue",
      "home",
      "merchant",
      "plan",
      "subscribe",
    ]);
  });

  it("gives every page a title, a description and an image", () => {
    for (const [name, definition] of Object.entries(PAGES)) {
      expect(definition.title.length, name).toBeGreaterThan(0);
      expect(definition.description.length, name).toBeGreaterThan(20);
      expect(definition.path.startsWith("/"), name).toBe(true);
      expect(definition.image.endsWith(".png"), name).toBe(false);
      expect(definition.image, name).toMatch(/^[a-z-]+$/);
    }
  });

  it("gives every page its own path", () => {
    const paths = Object.values(PAGES).map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
