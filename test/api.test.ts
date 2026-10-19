import { describe, expect, it, vi, afterEach } from "vitest";
import { api } from "@/lib/api";

/**
 * `api.ts` is the only seam between the UI and the indexer backend. The whole
 * contract is fail-soft: every method must resolve to `null` when the backend
 * is unreachable or misbehaving, so a downed indexer never crashes a page and
 * the UI can fall back to reading contract state directly. These tests pin
 * that promise down by mocking `fetch`.
 */

type FetchInput = string | URL | Request;

function mockFetch(impl: (url: FetchInput, init?: RequestInit) => Promise<unknown> | unknown) {
  vi.stubGlobal("fetch", impl);
}

function jsonResponse(body: unknown, status = 200, ok = true): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
    redirected: false,
    statusText: ok ? "OK" : "Error",
    type: "basic",
    url: "",
    clone: () => jsonResponse(body, status, ok),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api fail-soft behaviour", () => {
  it("returns null when the network request throws", async () => {
    mockFetch(() => Promise.reject(new Error("ENETUNREACH")));
    expect(await api.stats()).toBeNull();
    expect(await api.plans()).toBeNull();
    expect(await api.due()).toBeNull();
  });

  it("returns null on a non-2xx status instead of throwing", async () => {
    mockFetch(async () => jsonResponse({ error: "boom" }, 500, false));
    expect(await api.merchantSummary("GABC")).toBeNull();
  });

  it("returns null when the response is not valid JSON", async () => {
    // A body that is not parseable must be treated as a failed read, not a
    // crash: the app has to survive a half-rendered backend.
    vi.stubGlobal(
      "fetch",
      async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }) as unknown as Response,
    );
    expect(await api.charges(1)).toBeNull();
  });

  it("returns the parsed body on success", async () => {
    mockFetch(async (url) => {
      expect(String(url)).toContain("/api/stats");
      return jsonResponse({
        plans: 3,
        mandates: 7,
        activeMandates: 2,
        charges: 41,
        lastIndexedLedger: 1000,
      });
    });
    expect(await api.stats()).toEqual({
      plans: 3,
      mandates: 7,
      activeMandates: 2,
      charges: 41,
      lastIndexedLedger: 1000,
    });
  });

  it("queries the configured endpoint path and cache mode", async () => {
    let seenUrl = "";
    let seenCache: RequestCache | undefined;
    mockFetch(async (url, init) => {
      seenUrl = String(url);
      seenCache = init?.cache;
      return jsonResponse({ plans: [] });
    });
    await api.plans("GABC");
    expect(seenUrl).toContain("/api/plans?merchant=GABC");
    expect(seenCache).toBe("no-store");
  });

  it("queries the revenue endpoint with bucket, from and to", async () => {
    let seenUrl = "";
    mockFetch(async (url) => {
      seenUrl = String(url);
      return jsonResponse({ buckets: [] });
    });
    await api.merchantRevenue("GABC", { bucket: "week", from: 1000, to: 2000 });
    expect(seenUrl).toContain("/api/merchants/GABC/revenue?bucket=week&from=1000&to=2000");
    expect(seenUrl).not.toContain("NaN");
  });

  it("returns null for revenue when the backend cannot serve it", async () => {
    mockFetch(async () => jsonResponse({ error: "not found" }, 404, false));
    expect(await api.merchantRevenue("GABC")).toBeNull();
  });
});

describe("api.planStats", () => {
  it("returns the parsed body on success", async () => {
    mockFetch(async (url) => {
      expect(String(url)).toContain("/api/plans/5/stats");
      return jsonResponse({ subscriber_count: 12, total_collected: "120000000", cancellations: 2 });
    });
    expect(await api.planStats(5)).toEqual({
      subscriber_count: 12,
      total_collected: "120000000",
      cancellations: 2,
    });
  });

  it("returns null when the backend does not yet serve this endpoint", async () => {
    // payflow-backend#29 has not shipped yet; a 404 must be treated as
    // "endpoint unavailable", not as a crash.
    mockFetch(async () => jsonResponse({ error: "not found" }, 404, false));
    expect(await api.planStats(1)).toBeNull();
  });

  it("returns null when the network request throws", async () => {
    mockFetch(() => Promise.reject(new Error("ENETUNREACH")));
    expect(await api.planStats(1)).toBeNull();
  });

  it("queries the correct plan-specific URL", async () => {
    let seenUrl = "";
    mockFetch(async (url) => {
      seenUrl = String(url);
      return jsonResponse({ subscriber_count: 0, total_collected: "0", cancellations: 0 });
    });
    await api.planStats(99);
    expect(seenUrl).toContain("/api/plans/99/stats");
  });
});
