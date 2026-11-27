import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(new URL("../lighthouserc.json", import.meta.url), "utf8"),
) as {
  ci: {
    collect: { url: string[] };
    assert: {
      assertions: Record<
        string,
        [string, { maxNumericValue?: number; minScore?: number }]
      >;
      assertMatrix: Array<{
        matchingUrlPattern: string;
        assertions: Record<
          string,
          [string, { maxNumericValue?: number; minScore?: number }]
        >;
      }>;
    };
  };
};

describe("Lighthouse route performance budget", () => {
  it("collects every user-facing route and enforces its LCP budget", () => {
    expect(config.ci.collect.url).toEqual([
      "/",
      "/account/",
      "/m/",
      "/mandates/",
      "/merchant/",
      "/plans/1/",
      "/receipt/",
      "/status/",
      "/subscribe/",
    ]);
    expect(
      config.ci.assert.assertMatrix.map((rule) => [
        rule.matchingUrlPattern,
        rule.assertions["largest-contentful-paint"],
      ]),
    ).toEqual([
      ["https?://[^/]+/$", ["error", { maxNumericValue: 2500 }]],
      ["https?://[^/]+/account/$", ["error", { maxNumericValue: 3500 }]],
      ["https?://[^/]+/m/$", ["error", { maxNumericValue: 3300 }]],
      ["https?://[^/]+/mandates/$", ["error", { maxNumericValue: 2500 }]],
      ["https?://[^/]+/merchant/$", ["error", { maxNumericValue: 2500 }]],
      ["https?://[^/]+/plans/1/$", ["error", { maxNumericValue: 4800 }]],
      ["https?://[^/]+/receipt/$", ["error", { maxNumericValue: 2500 }]],
      ["https?://[^/]+/status/$", ["error", { maxNumericValue: 2500 }]],
      ["https?://[^/]+/subscribe/$", ["error", { maxNumericValue: 3600 }]],
    ]);
  });
});
