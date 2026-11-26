import { describe, expect, it } from "vitest";
import {
  buildTelemetryPayload,
  encodeTelemetry,
  rateVital,
  telemetryEndpoint,
  VITAL_THRESHOLDS,
} from "@/lib/telemetry";

/**
 * The pure telemetry contract (#331). The collector may not ship third-party
 * analytics, so its payload rules — what is rated, what is dropped, where it
 * may go — are pinned here rather than in a browser test.
 */

describe("rateVital", () => {
  it("uses the published Core Web Vitals boundaries", () => {
    expect(VITAL_THRESHOLDS.LCP).toEqual([2500, 4000]);
    expect(rateVital("LCP", 2500)).toBe("good");
    expect(rateVital("LCP", 2501)).toBe("needs-improvement");
    expect(rateVital("LCP", 4001)).toBe("poor");
  });

  it("rates each vital on its own scale", () => {
    expect(rateVital("CLS", 0.1)).toBe("good");
    expect(rateVital("CLS", 0.2)).toBe("needs-improvement");
    expect(rateVital("INP", 501)).toBe("poor");
    expect(rateVital("TTFB", 100)).toBe("good");
  });
});

describe("buildTelemetryPayload", () => {
  it("keeps only real samples and rounds them", () => {
    const payload = buildTelemetryPayload(
      "/subscribe/",
      [
        { name: "CLS", value: 0.123456 },
        { name: "LCP", value: 1234.6 },
        { name: "INP", value: Number.NaN },
        { name: "TTFB", value: -1 },
      ],
      1_700_000_000_000,
    );

    expect(payload.at).toBe(1_700_000_000_000);
    expect(payload.metrics).toEqual([
      { name: "CLS", value: 0.123, rating: "needs-improvement" },
      { name: "LCP", value: 1235, rating: "good" },
    ]);
  });

  it("sends the route, never query parameters that can identify a user", () => {
    const payload = buildTelemetryPayload(
      "/subscribe/?plan=12&address=GABC#section",
      [{ name: "FCP", value: 100 }],
    );
    expect(payload.page).toBe("/subscribe/");
  });

  it("falls back to / for an empty page name", () => {
    expect(buildTelemetryPayload("", []).page).toBe("/");
  });
});

describe("telemetryEndpoint", () => {
  it("is off unless configured", () => {
    expect(telemetryEndpoint(undefined)).toBeNull();
    expect(telemetryEndpoint("   ")).toBeNull();
  });

  it("accepts http(s) endpoints and rejects anything else", () => {
    expect(telemetryEndpoint("https://vitals.example.test/collect")).toBe(
      "https://vitals.example.test/collect",
    );
    expect(telemetryEndpoint("http://localhost:4000/vitals")).toBe(
      "http://localhost:4000/vitals",
    );
    expect(telemetryEndpoint("javascript:alert(1)")).toBeNull();
    expect(telemetryEndpoint("not a url")).toBeNull();
  });
});

describe("encodeTelemetry", () => {
  it("produces a single JSON body shared by beacon and fetch", () => {
    const body = encodeTelemetry(
      buildTelemetryPayload("/", [{ name: "LCP", value: 10 }], 5),
    );
    expect(JSON.parse(body)).toEqual({
      page: "/",
      at: 5,
      metrics: [{ name: "LCP", value: 10, rating: "good" }],
    });
  });
});
