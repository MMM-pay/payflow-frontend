import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { directTargets, parseQuery, planTargets } from "@/lib/search";
import en from "@/i18n/en.json";
import fr from "@/i18n/fr.json";

describe("header search", () => {
  const address = Keypair.random().publicKey();

  it("classifies addresses, ids and text", () => {
    expect(parseQuery(`  ${address} `)).toEqual({ kind: "address", address });
    expect(parseQuery("42")).toEqual({ kind: "id", id: 42 });
    expect(parseQuery("#7")).toEqual({ kind: "id", id: 7 });
    expect(parseQuery("pro")).toEqual({ kind: "text", text: "pro" });
  });

  it("treats blank, zero and one-letter queries as empty", () => {
    expect(parseQuery("   ").kind).toBe("empty");
    expect(parseQuery("0").kind).toBe("empty");
    expect(parseQuery("a").kind).toBe("empty");
  });

  it("does not take a malformed G address for an address", () => {
    expect(parseQuery(`${address.slice(0, -1)}A`).kind).not.toBe("address");
  });

  it("links an address to the merchant page and the account", () => {
    expect(directTargets(parseQuery(address)).map((t) => t.href)).toEqual([
      `/m/?address=${address}`,
      `/account/?address=${address}`,
    ]);
  });

  it("links an id to the mandate and the plan", () => {
    expect(directTargets(parseQuery("12")).map((t) => t.href)).toEqual(["/mandates/?id=12", "/plans/12"]);
  });

  it("matches plan names case-insensitively, capped at the limit", () => {
    const plans = [
      { id: 1, name: "Pro monthly" },
      { id: 2, name: "Basic" },
      { id: 3, name: "PRO yearly" },
      { id: 4, name: "" },
    ];
    expect(planTargets(plans, "pro").map((t) => t.href)).toEqual(["/plans/1", "/plans/3"]);
    expect(planTargets(plans, "pro", 1)).toHaveLength(1);
    expect(planTargets(plans, "zzz")).toEqual([]);
  });

  it("has every result label in both catalogs", () => {
    const labels = [
      ...directTargets(parseQuery(address)),
      ...directTargets(parseQuery("1")),
      ...planTargets([{ id: 1, name: "Pro" }], "pro"),
    ].map((t) => t.label);
    for (const label of labels) {
      expect(en).toHaveProperty([label]);
      expect(fr).toHaveProperty([label]);
    }
  });
});
