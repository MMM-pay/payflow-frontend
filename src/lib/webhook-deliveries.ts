/** Proposed response for payflow-backend#140; timestamps are Unix seconds. */
export interface WebhookDelivery {
  id: number;
  event_id: string;
  status: "pending" | "delivered" | "failed";
  http_status: number | null;
  error: string | null;
  attempt: number;
  retry_at: number | null;
}

export function parseWebhookDeliveries(body: unknown): WebhookDelivery[] | null {
  if (!body || typeof body !== "object" || !("deliveries" in body) || !Array.isArray(body.deliveries)) return null;
  const rows: WebhookDelivery[] = [];
  for (const value of body.deliveries) {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    if (!Number.isSafeInteger(row.id) || Number(row.id) < 0 ||
        typeof row.event_id !== "string" || !row.event_id ||
        !["pending", "delivered", "failed"].includes(String(row.status)) ||
        !Number.isSafeInteger(row.attempt) || Number(row.attempt) < 1 ||
        !(row.http_status === null || (Number.isInteger(row.http_status) && Number(row.http_status) >= 100 && Number(row.http_status) <= 599)) ||
        !(row.error === null || typeof row.error === "string") ||
        !(row.retry_at === null || (Number.isSafeInteger(row.retry_at) && Number(row.retry_at) >= 0 && Number(row.retry_at) <= 8640000000000))) return null;
    rows.push(row as unknown as WebhookDelivery);
  }
  // Preserve separate attempts, including a failure followed by success.
  return rows.slice(0, 100);
}

export function deliveryOutcome(row: WebhookDelivery): string {
  if (row.status === "delivered") return "Delivered";
  if (row.status === "failed" || row.error || (row.http_status !== null && row.http_status >= 300)) {
    return row.status === "pending" ? "Failed — retry pending" : "Failed";
  }
  return "Pending";
}

/** Read-only, resource- and network-bound proof; see docs/webhook-deliveries.md. */
export function deliveryHistoryMessage(merchant: string, id: string, timestamp: number, network: string): string {
  return JSON.stringify(["payflow-webhook-deliveries:v1", merchant, id, timestamp, network]);
}
