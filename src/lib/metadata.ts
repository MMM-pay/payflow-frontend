import type { Metadata } from "next";
import pagesJson from "./pages.json";

/**
 * Per-page metadata.
 *
 * The site is a static export served from GitHub Pages under `/payflow-frontend`,
 * so every absolute URL — canonical link, Open Graph image, share target — has
 * to carry the base path. Building them by hand is where that goes wrong, so
 * the URLs are assembled in one place (`absoluteUrl`) and the page definitions
 * live in `pages.json`, which the build script that draws the social images
 * reads as well. One list, so an image can never drift from the page it
 * belongs to.
 */

/** What every page needs to describe itself. */
export interface PageDefinition {
  /** Title without the site suffix; the root layout's template adds "· Payflow". */
  title: string;
  /** One or two sentences, used for the search result and the share preview. */
  description: string;
  /** Route path with a trailing slash, as the static export serves it. */
  path: string;
  /** File name of the social image under `public/og/`, without the extension. */
  image: string;
}

/**
 * Every route of the app, keyed by a short name.
 *
 * The keys are the ones in `pages.json`, not a plain string index: a page
 * that does not exist is a compile error rather than `undefined` at runtime.
 */
export const PAGES = pagesJson as {
  [K in keyof typeof pagesJson]: PageDefinition;
};

/**
 * Where the site lives. Overridable so a fork on another host (or a local
 * preview) can point its share links at itself.
 */
export const SITE_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://mmm-pay.github.io"
).replace(/\/+$/, "");

/**
 * The path the static export is served from. GitHub Pages serves a project
 * site from `/<repo>`, so this is `/payflow-frontend` there and empty
 * everywhere else.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/**
 * An absolute URL for a path inside the app, base path included.
 *
 * Every link a crawler follows has to be absolute and has to include the base
 * path: a crawler that resolves `/og/home.png` against the origin gets a 404
 * on GitHub Pages, because the file is served from `/payflow-frontend/og/…`.
 */
export function absoluteUrl(
  path: string,
  origin: string = SITE_ORIGIN,
  basePath: string = BASE_PATH,
): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${origin.replace(/\/+$/, "")}${basePath.replace(/\/+$/, "")}${suffix}`;
}

/**
 * The base every relative metadata URL is resolved against.
 *
 * It keeps the base path, so `metadataBase` + a relative image path still
 * points inside `/payflow-frontend` rather than at the domain root.
 */
export function metadataBase(
  origin: string = SITE_ORIGIN,
  basePath: string = BASE_PATH,
): URL {
  return new URL(`${basePath.replace(/\/+$/, "")}/`, `${origin.replace(/\/+$/, "")}/`);
}

/** The social image for a page, as an absolute URL. */
export function ogImageUrl(
  page: PageDefinition,
  origin: string = SITE_ORIGIN,
  basePath: string = BASE_PATH,
): string {
  return absoluteUrl(`/og/${page.image}.png`, origin, basePath);
}

/**
 * The metadata for one page: title, description, canonical link and the
 * Open Graph and Twitter cards that make a shared link show a preview.
 *
 * `absoluteTitle` opts out of the root layout's "%s · Payflow" template. The
 * home page uses it: its title already names the site, so the template would
 * only repeat it.
 */
export function pageMetadata(
  page: PageDefinition,
  options: { absoluteTitle?: boolean; path?: string } = {},
): Metadata {
  const url = absoluteUrl(options.path ?? page.path);
  const image = ogImageUrl(page);
  const imageAlt = `${page.title} · Payflow`;

  return {
    title: options.absoluteTitle ? { absolute: page.title } : page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: "Payflow",
      title: page.title,
      description: page.description,
      url,
      images: [{ url: image, width: 1200, height: 630, alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: [image],
    },
  };
}
