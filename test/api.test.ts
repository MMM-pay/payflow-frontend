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
