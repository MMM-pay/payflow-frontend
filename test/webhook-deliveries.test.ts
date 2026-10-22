import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { deliveryHistoryMessage, deliveryOutcome, parseWebhookDeliveries, type WebhookDelivery } from "@/lib/webhook-deliveries";

vi.mock("@/lib/config", () => ({ config: { apiUrl: "https://api.example.test" } }));
const failed: WebhookDelivery = { id: 1, event_id: "charge:abc", status: "pending", http_status: 503, error: null, attempt: 1, retry_at: 1792584000 };
const delivered: WebhookDelivery = { ...failed, id: 2, status: "delivered", http_status: 200, attempt: 2, retry_at: null };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("delivery history", () => {
  it("keeps both failed and successful attempts of the same event", () => {
    expect(parseWebhookDeliveries({ deliveries: [delivered, failed] })).toEqual([delivered, failed]);
    expect(deliveryOutcome(failed)).toBe("Failed — retry pending");
    expect(deliveryOutcome(delivered)).toBe("Delivered");
    expect(deliveryOutcome({ ...failed, http_status: null, error: "Timeout" })).toContain("Failed");
    expect(deliveryOutcome({ ...failed, status: "failed" })).toBe("Failed");
    expect(deliveryOutcome({ ...failed, http_status: null })).toBe("Pending");
  });
  it("distinguishes empty history from unsupported or invalid responses", () => {
    expect(parseWebhookDeliveries({ deliveries: [] })).toEqual([]);
    for (const body of [null, {}, [], { deliveries: [{}] }, { deliveries: [{ ...failed, attempt: -1 }] }, { deliveries: [{ ...failed, retry_at: 1e20 }] }, { deliveries: [{ ...failed, http_status: "503" }] }]) {
      expect(parseWebhookDeliveries(body)).toBeNull();
    }
    expect(parseWebhookDeliveries({ deliveries: Array(101).fill(failed) })).toHaveLength(100);
  });
  it("binds signatures to account, resource, timestamp and network", () => {
    expect(deliveryHistoryMessage("GA", "12", 123, "Testnet")).toBe('["payflow-webhook-deliveries:v1","GA","12",123,"Testnet"]');
  });
  it("never sends a request with the API disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", " ");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await api.webhookDeliveries("12", { merchant: "GA", timestamp: 123, signature: "proof" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends proofs in headers, encodes IDs and disables caching and redirects", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deliveries: [failed] }) });
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await api.webhookDeliveries("a/b", { merchant: "GA", timestamp: 123, signature: "proof" }, signal)).toEqual([failed]);
    expect(fetch).toHaveBeenCalledWith("https://api.example.test/api/webhooks/a%2Fb/deliveries", {
      cache: "no-store", redirect: "error", signal,
      headers: { "X-Payflow-Merchant": "GA", "X-Payflow-Timestamp": "123", "X-Payflow-Signature": "proof" },
    });
  });
  it.each([404, 401, 503])("fails soft for HTTP %i", async (status) => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
    expect(await api.webhookDeliveries("12", { merchant: "GA", timestamp: 123, signature: "proof" })).toBeNull();
  });
  it("fails soft on transport and JSON failures", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("bad json"); } });
    vi.stubGlobal("fetch", fetch);
    for (let i = 0; i < 2; i++) expect(await api.webhookDeliveries("12", { merchant: "GA", timestamp: 123, signature: "proof" })).toBeNull();
  });
});
