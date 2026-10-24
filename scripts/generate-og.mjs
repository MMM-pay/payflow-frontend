import { ImageResponse } from "next/og.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";

/**
 * Draws the Open Graph image for every page.
 *
 * Next's own `opengraph-image` route works in a static export, but the file it
 * writes has no extension, so GitHub Pages serves it as
 * `application/octet-stream` and the link-preview crawlers refuse it. These
 * images are written to `public/og/<page>.png` instead, which is served with
 * the right content type everywhere.
 *
 * The page list comes from `src/lib/pages.json`, the same file the metadata
 * reads, so an image can never drift from the page it belongs to.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pagesPath = join(root, "src", "lib", "pages.json");
const outDir = join(root, "public", "og");

const WIDTH = 1200;
const HEIGHT = 630;

const INK = "#0b0e14";
const EDGE = "#232b38";
const MUTED = "#8b97a8";
const ACCENT = "#3ddc97";
const TEXT = "#e2e8f0";

function card({ title, description }) {
  return React.createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: INK,
        color: TEXT,
        padding: "64px 72px",
      },
    },
    [
      React.createElement(
        "div",
        { style: { display: "flex", alignItems: "center" } },
        [
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                width: 56,
                height: 56,
                marginRight: 20,
                borderRadius: 14,
                backgroundColor: ACCENT,
                color: INK,
                fontSize: 34,
                fontWeight: 700,
                alignItems: "center",
                justifyContent: "center",
              },
            },
            "P",
          ),
          React.createElement(
            "div",
            { style: { display: "flex", fontSize: 40, fontWeight: 600 } },
            [
              React.createElement("span", { style: { color: TEXT } }, "Pay"),
              React.createElement("span", { style: { color: ACCENT } }, "flow"),
            ],
          ),
        ],
      ),

      React.createElement(
        "div",
        { style: { display: "flex", flexDirection: "column" } },
        [
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                fontSize: title.length > 32 ? 54 : 64,
                fontWeight: 700,
                lineHeight: 1.15,
                maxWidth: 1010,
                marginBottom: 22,
              },
            },
            title,
          ),
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                fontSize: 28,
                lineHeight: 1.45,
                color: MUTED,
                maxWidth: 960,
              },
            },
            description,
          ),
        ],
      ),

      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${EDGE}`,
            paddingTop: 28,
            fontSize: 24,
            color: MUTED,
          },
        },
        [
          React.createElement(
            "div",
            { style: { display: "flex" } },
            "mmm-pay.github.io/payflow-frontend",
          ),
          React.createElement(
            "div",
            { style: { display: "flex", color: ACCENT } },
            "Recurring payments on Stellar",
          ),
        ],
      ),
    ],
  );
}

const pages = JSON.parse(await readFile(pagesPath, "utf8"));
await mkdir(outDir, { recursive: true });

for (const [name, page] of Object.entries(pages)) {
  const response = new ImageResponse(card(page), { width: WIDTH, height: HEIGHT });
  const bytes = Buffer.from(await response.arrayBuffer());
  const file = join(outDir, `${page.image}.png`);
  await writeFile(file, bytes);
  console.log(`wrote ${file} (${bytes.length} bytes) for ${name}`);
}
