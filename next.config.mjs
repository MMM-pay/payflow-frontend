import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { cspConnectSources } from "./scripts/csp.mjs";

// Copy embed files into public/embed so they are included in static export
if (existsSync("./embed")) {
  mkdirSync("./public/embed", { recursive: true });
  cpSync("./embed", "./public/embed", { recursive: true });
}

/** @type {import('next').NextConfig} */

// GitHub Pages serves a project site from /<repo>, so assets need a basePath.
// Vercel and local dev serve from the root and set nothing.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// The post-export CSP step builds the same policy in its own process, so the
// origin list lives in one module rather than being written down twice.
const connectSources = cspConnectSources();

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
  // Keep stable vendor code in its own long-lived chunk so it survives deploys
  // instead of being re-downloaded with every application change.
  turbopack: {},
  webpack: (config) => {
    config.optimization = config.optimization ?? {};
    config.optimization.splitChunks = {
      chunks: "all",
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: "vendors",
          chunks: "all",
          priority: 20,
          reuseExistingChunk: true,
        },
        common: {
          name: "common",
          minChunks: 2,
          chunks: "all",
          priority: 10,
          reuseExistingChunk: true,
        },
      },
    };
    return config;
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_COMMIT_HASH: commitHash,
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_CSP_CONNECT_SRC: [...new Set(connectSources)].join(" "),
  },
};

export default nextConfig;

