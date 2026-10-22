import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";

// Copy embed files into public/embed so they are included in static export
if (existsSync("./embed")) {
  mkdirSync("./public/embed", { recursive: true });
  cpSync("./embed", "./public/embed", { recursive: true });
}

/** @type {import('next').NextConfig} */

// GitHub Pages serves a project site from /<repo>, so assets need a basePath.
// Vercel and local dev serve from the root and set nothing.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || pkg.version || "";

function resolveCommitHash() {
  if (process.env.NEXT_PUBLIC_COMMIT_HASH) {
    return process.env.NEXT_PUBLIC_COMMIT_HASH;
  }
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA.slice(0, 7);
  }
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const commitHash = resolveCommitHash();

const nextConfig = {
  reactStrictMode: true,
  // Every route is client-rendered, so the app exports to plain static files.
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_COMMIT_HASH: commitHash,
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;

