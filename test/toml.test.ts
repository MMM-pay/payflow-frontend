import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTomlCache,
  loadOrgName,
  orgNameFromToml,
} from "@/lib/toml";

/**
 * Merchant names (issue #43) are self-declared: home_domain on the account,
 * stellar.toml on that domain, ORG_NAME in the toml. The rules pinned here:
 * a name resolves quietly or not at all, no toml request happens when the
 * account publishes no home domain, and both hits and misses are cached so a
 * flapping network cannot hammer Horizon.
 */

const ALICE = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";
const BOB = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";
const CAROL = "GAEWDXVDI3WI35TWTZXNQ4NTRYIG6J34XPRSNKX655LBA377M5ZOCBY5";

beforeEach(() => {
  clearTomlCache();
});

describe("orgNameFromToml", () => {
  it("reads ORG_NAME from the file level", () => {
    expect(orgNameFromToml('ORG_NAME = "Acme Payments"')).toBe("Acme Payments");
  });

  it("reads ORG_NAME from [GENERAL]", () => {
    expect(orgNameFromToml('[GENERAL]\nORG_NAME = "Acme Payments"')).toBe(
      "Acme Payments",
    );
  });

  it("ignores ORG_NAME inside other sections and comments", () => {
    const toml = [
      "# ORG_NAME = \"Commented out\"",
      "[DOCUMENTATION]",
      'ORG_NAME = "Wrong Section"',
      "[GENERAL]",
      'ORG_NAME = "Right One"',
    ].join("\n");
    expect(orgNameFromToml(toml)).toBe("Right One");
  });

  it("tolerates whitespace, CRLF and a trailing comment", () => {
    expect(orgNameFromToml('  ORG_NAME   =   "Spacious"  # note')).toBe("Spacious");
    expect(orgNameFromToml('ORG_NAME = "CRLF"\r\n')).toBe("CRLF");
  });

  it("returns null rather than a blank name", () => {
    expect(orgNameFromToml('ORG_NAME = ""')).toBeNull();
    expect(orgNameFromToml("[DOCUMENTATION]\n")).toBeNull();
    expect(orgNameFromToml("")).toBeNull();
  });
});

describe("loadOrgName", () => {
  it("resolves the name through home domain and stellar.toml", async () => {
    const toml = vi.fn(async () => 'ORG_NAME = "Acme Payments"');
    const name = await loadOrgName(ALICE, {
      homeDomain: async () => "acme.example.com",
      toml,
    });
    expect(name).toBe("Acme Payments");
    expect(toml).toHaveBeenCalledWith(
      "https://acme.example.com/.well-known/stellar.toml",
    );
  });

  it("makes no toml request when the account has no home domain", () => {
    // Acceptance criterion for #43: no request when nothing is published.
    const toml = vi.fn(async () => 'ORG_NAME = "Should Not Load"');
    return loadOrgName(BOB, { homeDomain: async () => "", toml }).then((name) => {
      expect(name).toBeNull();
      expect(toml).not.toHaveBeenCalled();
    });
  });

  it("strips a stray scheme or path from the home domain", async () => {
    const toml = vi.fn(async () => 'ORG_NAME = "Acme"');
    await loadOrgName(CAROL, {
      homeDomain: async () => "https://Acme.example.com/pricing",
      toml,
    });
    expect(toml).toHaveBeenCalledWith("https://acme.example.com/.well-known/stellar.toml");
  });

  it("fails quietly when Horizon cannot answer", async () => {
    const name = await loadOrgName(ALICE, {
      homeDomain: async () => {
        throw new Error("Horizon responded 500");
      },
      toml: vi.fn(async () => 'ORG_NAME = "Nope"'),
    });
    expect(name).toBeNull();
  });

  it("fails quietly when the toml cannot be fetched", async () => {
    const name = await loadOrgName(BOB, {
      homeDomain: async () => "dead.example.com",
      toml: async () => null,
    });
    expect(name).toBeNull();
  });

  it("caches hits and misses, and clearTomlCache resets both", async () => {
    const homeDomain = vi.fn(async () => "acme.example.com");
    const toml = vi.fn(async () => 'ORG_NAME = "Acme"');

    expect(await loadOrgName(ALICE, { homeDomain, toml })).toBe("Acme");
    expect(await loadOrgName(ALICE, { homeDomain, toml })).toBe("Acme");
    expect(homeDomain).toHaveBeenCalledTimes(1);

    const missHome = vi.fn(async () => "");
    expect(await loadOrgName(BOB, { homeDomain: missHome, toml })).toBeNull();
    expect(await loadOrgName(BOB, { homeDomain: missHome, toml })).toBeNull();
    expect(missHome).toHaveBeenCalledTimes(1);

    clearTomlCache();
    await loadOrgName(ALICE, { homeDomain, toml });
    expect(homeDomain).toHaveBeenCalledTimes(2);
  });
});
