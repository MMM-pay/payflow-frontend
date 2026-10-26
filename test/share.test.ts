import { describe, expect, it } from "vitest";
import { catalogueLink, planParam, subscribeLink } from "@/lib/share";

/**
 * The link a merchant sends to a customer (issue #19). Two things have to be
 * right or the link is useless: it has to name the plan, and it has to carry
 * the base path the static export is served from — on GitHub Pages the app
 * lives under `/payflow-frontend`, and a link without it 404s.
 */

describe("subscribeLink", () => {
  it("points at one plan on the subscribe page", () => {
    expect(subscribeLink("https://mmm-pay.github.io", 12, "")).toBe(
      "https://mmm-pay.github.io/subscribe/?plan=12",
    );
  });

  it("carries the base path of the static export", () => {
    expect(subscribeLink("https://mmm-pay.github.io", 12, "/payflow-frontend")).toBe(
      "https://mmm-pay.github.io/payflow-frontend/subscribe/?plan=12",
    );
  });

  it("does not double up the slashes", () => {
    expect(subscribeLink("https://example.com/", 3, "/app/")).toBe(
      "https://example.com/app/subscribe/?plan=3",
    );
  });

  it("takes a bigint plan id", () => {
    expect(subscribeLink("https://example.com", 12n, "")).toContain("plan=12");
  });
});

describe("catalogueLink", () => {
  it("points at the whole catalogue", () => {
    expect(catalogueLink("https://mmm-pay.github.io", "/payflow-frontend")).toBe(
      "https://mmm-pay.github.io/payflow-frontend/subscribe/",
    );
  });
});

describe("planParam", () => {
  it("reads a plan id", () => {
    expect(planParam("12")).toEqual({ kind: "plan", id: 12 });
  });

  it("treats a missing parameter as the whole catalogue", () => {
    expect(planParam(null)).toEqual({ kind: "all" });
    expect(planParam(undefined)).toEqual({ kind: "all" });
    expect(planParam("")).toEqual({ kind: "all" });
    expect(planParam("   ")).toEqual({ kind: "all" });
  });

  it("rejects a parameter that cannot be a plan id", () => {
    // Plans are numbered from 1, so 0 and a negative number name no plan.
    for (const raw of ["abc", "1.5", "-1", "0", "1 2", "12abc", "٣"]) {
      expect(planParam(raw), raw).toEqual({ kind: "invalid" });
    }
  });

  it("rejects a number too large to be a plan id", () => {
    expect(planParam("99999999999999999999")).toEqual({ kind: "invalid" });
  });

  it("ignores the spaces around a plan id", () => {
    expect(planParam(" 12 ")).toEqual({ kind: "plan", id: 12 });
  });
});
