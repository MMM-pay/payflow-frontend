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

function httpOrigin(value) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:", "ws:", "wss:"].includes(url.protocol)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

const connectSources = [
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
  process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  process.env.NEXT_PUBLIC_API_URL === undefined
    ? "http://localhost:8080"
    : process.env.NEXT_PUBLIC_API_URL,
  ...(process.env.NEXT_PUBLIC_STELLAR_TOML_ORIGINS ?? "").split(","),
  "https://relay.walletconnect.com",
  "wss://relay.walletconnect.com",
  "https://api.web3modal.org",
  "https://pulse.walletconnect.com",
]
  .map(httpOrigin)
  .filter(Boolean);

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
    NEXT_PUBLIC_CSP_CONNECT_SRC: [...new Set(connectSources)].join(" "),
  },
};

export default nextConfig;

