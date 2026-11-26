import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, clearApiCache } from "@/lib/api";

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

beforeEach(() => {
  clearApiCache();
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://backend.test");
});

afterEach(() => {
  clearApiCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("api client memory cache", () => {
  it("serves cached read on repeated calls within TTL", async () => {
    let fetchCount = 0;
    mockFetch(async () => {
      fetchCount++;
      return jsonResponse({
        plans: 5,
        mandates: 10,
        activeMandates: 2,
        charges: 50,
        lastIndexedLedger: 1000,
      });
    });

    const first = await api.stats();
    expect(first?.plans).toBe(5);
    expect(fetchCount).toBe(1);

    const second = await api.stats();
    expect(second?.plans).toBe(5);
    expect(fetchCount).toBe(1); // Served from cache
  });

  it("refetches after TTL expires", async () => {
    let fetchCount = 0;
    mockFetch(async () => {
      fetchCount++;
      return jsonResponse({ plans: [] });
    });

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    await api.plans();
    expect(fetchCount).toBe(1);

    // Within TTL (30s)
    nowSpy.mockReturnValue(1000 + 15_000);
    await api.plans();
    expect(fetchCount).toBe(1);

    // After TTL
    nowSpy.mockReturnValue(1000 + 35_000);
    await api.plans();
    expect(fetchCount).toBe(2);

    nowSpy.mockRestore();
  });

  it("clearApiCache invalidates cached reads", async () => {
    let fetchCount = 0;
    mockFetch(async () => {
      fetchCount++;
      return jsonResponse({ plans: [] });
    });

    await api.plans();
    expect(fetchCount).toBe(1);

    clearApiCache();
    await api.plans();
    expect(fetchCount).toBe(2);
  });
});
