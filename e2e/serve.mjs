/**
 * Minimal static file server for the Next.js export in out/, used by the
 * visual regression tests. Zero dependencies so local and CI runs serve the
 * same bytes. With `trailingSlash: true` Next writes route/index.html per
 * page, which the `/{page}/` URLs resolve to directly; anything unknown
 * falls through to the exported 404 page.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = normalize(fileURLToPath(new URL("../out/", import.meta.url))).replace(
  /[/\\]+$/,
  "",
);
const port = Number(process.env.PORT ?? 4173);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://localhost").pathname,
    );
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = normalize(join(root, pathname));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    const notFound = await readFile(join(root, "404.html")).catch(() =>
      Buffer.from("not found"),
    );
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(notFound);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`serving out/ at http://127.0.0.1:${port}`);
});
