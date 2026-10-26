import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  // Contract-only tests stub NEXT_PUBLIC_API_URL; without this, the stub
  // leaks into the next test and every isConfigured() call reads "".
  vi.unstubAllEnvs();
  vi.resetModules();
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

  it("api.charge returns matching charge or null", async () => {
    mockFetch(async (url) => {
      expect(String(url)).toContain("/api/mandates/5/charges");
      return jsonResponse({
        charges: [
          {
            tx_hash: "target_hash",
            mandate_id: 5,
            amount: "1000",
            fee: "10",
            charges_made: 1,
            ledger: 100,
          },
        ],
      });
    });

    const found = await api.charge(5, "target_hash");
    expect(found?.tx_hash).toBe("target_hash");

    const notFound = await api.charge(5, "different_hash");
    expect(notFound).toBeNull();
  });

  it("api.mandate returns parsed mandate or null on failure", async () => {
    mockFetch(async (url) => {
      expect(String(url)).toContain("/api/mandates/5");
      return jsonResponse({
        id: 5,
        subscriber: "GSUB",
        merchant: "GMER",
        status: "Active",
      });
    });

    const mandate = await api.mandate(5);
    expect(mandate?.id).toBe(5);
    expect(mandate?.subscriber).toBe("GSUB");

    mockFetch(() => Promise.reject(new Error("offline")));
    expect(await api.mandate(5)).toBeNull();
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

  it("parses timeline events and rejects malformed timeline responses", async () => {
    mockFetch(async (url) => {
      expect(String(url)).toContain("/api/mandates/7/timeline");
      return jsonResponse({
        events: [
          {
            event_id: "evt-1",
            mandate_id: 7,
            type: "charged",
            ledger: 42,
            amount: "1000000",
            token: "C_TOKEN",
            token_symbol: "USDC",
            token_decimals: 6,
          },
        ],
      });
    });
    expect(await api.timeline(7)).toEqual({
      events: [
        {
          event_id: "evt-1",
          mandate_id: 7,
          type: "charged",
          ledger: 42,
          amount: "1000000",
          token: "C_TOKEN",
          token_symbol: "USDC",
          token_decimals: 6,
        },
      ],
    });

    const invalidEvents = [
      { type: "charged", mandate_id: 7, ledger: 42 },
      { event_id: "x", mandate_id: 7, type: "unknown", ledger: 42 },
      { event_id: "x", mandate_id: 7, type: "charged", ledger: 0 },
      { event_id: "x", mandate_id: 8, type: "charged", ledger: 42 },
      { event_id: "x", mandate_id: 7, type: "charged", ledger: 42, amount: "1.5" },
      { event_id: "x", mandate_id: 7, type: "charged", ledger: 42, token_decimals: 19 },
      { event_id: "x", mandate_id: 7, type: "charged", ledger: 42, token: "C_TOKEN" },
      { event_id: "x", mandate_id: 7, type: "charged", ledger: 42, token_symbol: "USDC" },
      { event_id: "x", mandate_id: 7, type: "charged", ledger: 42, token_decimals: 6 },
      {
        event_id: "x",
        mandate_id: 7,
        type: "charged",
        ledger: 42,
        token: "C_TOKEN",
        token_symbol: null,
        token_decimals: 6,
      },
    ];
    for (const event of invalidEvents) {
      mockFetch(async () => jsonResponse({ events: [event] }));
      expect(await api.timeline(7)).toBeNull();
    }

    mockFetch(async () => jsonResponse({ data: [] }));
    expect(await api.timeline(7)).toBeNull();

    mockFetch(async () =>
      jsonResponse({
        events: [
          {
            event_id: "raw",
            mandate_id: 7,
            type: "charged",
            ledger: 42,
            amount: "1000000",
          },
          {
            event_id: "raw-null",
            mandate_id: 7,
            type: "charged",
            ledger: 41,
            token: null,
            token_symbol: null,
            token_decimals: null,
          },
        ],
      }),
    );
    expect(await api.timeline(7)).not.toBeNull();
  });
});

describe("api.planStats", () => {
  it("returns the parsed body on success", async () => {
    mockFetch(async (url) => {
      expect(String(url)).toContain("/api/plans/5/stats");
      return jsonResponse({ subscriber_count: 12, total_collected: "120000000", cancellations: 2 });
    });

    describe("api.merchantChurn", () => {
      it("requests the documented monthly churn endpoint", async () => {
        let seenUrl = "";
        mockFetch(async (url, init) => {
          seenUrl = String(url);
          expect(init?.cache).toBe("no-store");
          return jsonResponse({ merchant: "GABC", bucket: "month", buckets: [], totals: {} });
        });

        await api.merchantChurn("GABC");

        expect(seenUrl).toContain("/api/merchants/GABC/churn?bucket=month");
      });

      it("returns null without issuing a request when NEXT_PUBLIC_API_URL is empty", async () => {
        vi.stubEnv("NEXT_PUBLIC_API_URL", "");
        vi.resetModules();
        const { api: unconfiguredApi } = await import("@/lib/api");
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        expect(unconfiguredApi.isConfigured()).toBe(false);
        expect(await unconfiguredApi.merchantChurn("GABC")).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("returns null when the endpoint is unavailable or fails", async () => {
        mockFetch(async () => jsonResponse({ error: "not found" }, 404, false));
        expect(await api.merchantChurn("GABC")).toBeNull();

        mockFetch(() => Promise.reject(new Error("ENETUNREACH")));
        expect(await api.merchantChurn("GABC")).toBeNull();
      });
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

describe("api.health and api.keeper", () => {
  // Vitest does not load .env.local, so isConfigured() is false by default;
  // these tests exercise the configured path and stub the URL explicitly.
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://backend.test");
  });

  it("serves /health at the root, not under /api", async () => {
    // payflow-backend mounts the liveness probe at the root; /api/health 404s.
    // config.apiUrl is frozen at import, so only the path is asserted here.
    let seenUrl = "";
    mockFetch(async (url) => {
      seenUrl = String(url);
      return jsonResponse({ status: "ok", indexer: null });
    });
    expect(await api.health()).toEqual({ status: "ok", indexer: null });
    expect(seenUrl.endsWith("/health")).toBe(true);
    expect(seenUrl).not.toContain("/api/health");
  });

  it("queries /api/keeper for pass history", async () => {
    let seenUrl = "";
    mockFetch(async (url) => {
      seenUrl = String(url);
      return jsonResponse({ passes: [] });
    });
    expect(await api.keeper()).toEqual({ passes: [] });
    expect(seenUrl.endsWith("/api/keeper")).toBe(true);
  });

  it("returns null for both when the backend is unreachable", async () => {
    mockFetch(() => Promise.reject(new Error("ENETUNREACH")));
    expect(await api.health()).toBeNull();
    expect(await api.keeper()).toBeNull();

    mockFetch(async () => jsonResponse({ error: "down" }, 503, false));
    expect(await api.health()).toBeNull();
    expect(await api.keeper()).toBeNull();
  });

  it("issues no request at all in contract-only mode", async () => {
    // An empty NEXT_PUBLIC_API_URL must not become a same-origin fetch
    // against the static host, which could only 404.
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.resetModules();
    const { api: unconfiguredApi } = await import("@/lib/api");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(unconfiguredApi.isConfigured()).toBe(false);
    expect(await unconfiguredApi.health()).toBeNull();
    expect(await unconfiguredApi.keeper()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
