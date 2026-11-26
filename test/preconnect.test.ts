import { describe, expect, it } from "vitest";
import { preconnectOrigins } from "@/lib/preconnect";

/**
 * The preconnect hints are built from build-time URLs, so the interesting cases
 * are the ones an empty or partial configuration produces: contract-only mode
 * has no API URL, and a malformed one must not become a broken `<link>`.
 */
describe("preconnectOrigins", () => {
  it("reduces URLs to origins, dropping the path", () => {
    expect(preconnectOrigins(["https://rpc.example.org/soroban/testnet"])).toEqual([
      "https://rpc.example.org",
    ]);
  });

  it("keeps a non-default port, because that is its own connection pool", () => {
    expect(preconnectOrigins(["http://localhost:8080"])).toEqual(["http://localhost:8080"]);
  });

  it("keeps the first occurrence of an origin and drops repeats", () => {
    expect(
      preconnectOrigins([
        "https://soroban-testnet.stellar.org",
        "https://soroban-testnet.stellar.org/",
        "https://horizon-testnet.stellar.org",
        "https://soroban-testnet.stellar.org/soroban/rpc",
      ]),
    ).toEqual(["https://soroban-testnet.stellar.org", "https://horizon-testnet.stellar.org"]);
  });

  it("skips empty and missing values, which is contract-only mode", () => {
    expect(preconnectOrigins(["", "   ", null, undefined])).toEqual([]);
    expect(preconnectOrigins(["", "https://rpc.example.org", ""])).toEqual([
      "https://rpc.example.org",
    ]);
  });

  it("skips values that are not absolute web URLs", () => {
    expect(
      preconnectOrigins([
        "/api",
        "api.example.org",
        "ftp://files.example.org",
        "javascript:alert(1)",
      ]),
    ).toEqual([]);
  });

  it("normalises the host so one origin is never hinted twice", () => {
    expect(
      preconnectOrigins(["HTTPS://RPC.Example.org", "https://rpc.example.org:443"]),
    ).toEqual(["https://rpc.example.org"]);
  });
});
