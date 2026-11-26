import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiMandate } from "@/lib/api";
import type { Mandate } from "@/lib/payflow";

/**
 * Issue #27: in contract-only mode the dashboard used to read only the newest
 * 100 mandates. Paging must reach older ones and never list a mandate twice.
 */

const payflowMock = vi.hoisted(() => ({
  merchantMandateCount: vi.fn(),
  merchantMandates: vi.fn(),
  getMandate: vi.fn(),
}));

vi.mock("@/lib/lazy-payflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payflow")>();
  return { ...actual, payflow: payflowMock };
});

import {
  chainMerchantMandatesPage,
  indexWindow,
  mergeMandates,
  MERCHANT_MANDATE_PAGE_SIZE,
} from "@/lib/chain";

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";
const SUBSCRIBER = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";

function contractMandate(id: number): Mandate {
  return {
    id: BigInt(id),
    subscriber: SUBSCRIBER,
    merchant: MERCHANT,
    plan_id: 1n,
    token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    amount: 10_000_000n,
    period: 2_592_000n,
    next_charge: 0n,
    last_charge: 0n,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: ["Active"],
  };
}

function apiMandate(id: number): ApiMandate {
  return {
    id,
    subscriber: SUBSCRIBER,
    merchant: MERCHANT,
    plan_id: 1,
    amount: "10000000",
    period: 2_592_000,
    next_charge: 0,
    last_charge: 0,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("indexWindow", () => {
  it("walks an oldest-first index backwards from the end", () => {
    expect(indexWindow(120, 0, 50)).toEqual([70, 50]);
    expect(indexWindow(120, 50, 50)).toEqual([20, 50]);
    expect(indexWindow(120, 100, 50)).toEqual([0, 20]);
  });

  it("returns null once every row has been paged through", () => {
    expect(indexWindow(120, 120, 50)).toBeNull();
    expect(indexWindow(0, 0, 50)).toBeNull();
  });

  it("does not produce a negative start for an offset past the end", () => {
    expect(indexWindow(10, 99, 50)).toBeNull();
  });

  it("treats malformed counts as an empty index", () => {
    expect(indexWindow(Number.NaN, 0, 50)).toBeNull();
    expect(indexWindow(10, 0, 0)).toBeNull();
  });
});

describe("mergeMandates", () => {
  it("dedupes by id and keeps the newest first", () => {
    const merged = mergeMandates(
      [apiMandate(5), apiMandate(3)],
      [apiMandate(4), apiMandate(3)],
    );
    expect(merged.map((m) => m.id)).toEqual([5, 4, 3]);
  });

  it("does not mutate the rows it was given", () => {
    const existing = [apiMandate(2), apiMandate(1)];
    const incoming = [apiMandate(3)];
    mergeMandates(existing, incoming);
    expect(existing.map((m) => m.id)).toEqual([2, 1]);
    expect(incoming.map((m) => m.id)).toEqual([3]);
  });
});

describe("chainMerchantMandatesPage", () => {
  const total = 120;
  const index = Array.from({ length: total }, (_, i) => contractMandate(i + 1));

  function mockIndex(): void {
    payflowMock.merchantMandateCount.mockResolvedValue(total);
    payflowMock.merchantMandates.mockImplementation(
      async (_source: string, _merchant: string, start: number, limit: number) =>
        index.slice(start, start + limit).map((m) => m.id),
    );
    payflowMock.getMandate.mockImplementation(
      async (_source: string, id: bigint) => index.find((m) => m.id === id),
    );
  }

  it("reaches every one of 120 mandates by paging, with no duplicates", async () => {
    mockIndex();

    let rows: ApiMandate[] = [];
    let offset = 0;
    let done = false;
    let pages = 0;
    while (!done) {
      const page = await chainMerchantMandatesPage(MERCHANT, MERCHANT, offset, MERCHANT_MANDATE_PAGE_SIZE);
      expect(page.total).toBe(total);
      rows = mergeMandates(rows, page.rows);
      offset += page.rows.length;
      done = offset >= total;
      pages += 1;
      // A regression that stops returning rows must fail, not spin forever.
      expect(pages).toBeLessThan(10);
    }

    expect(pages).toBe(3);
    expect(rows).toHaveLength(total);
    expect(new Set(rows.map((m) => m.id)).size).toBe(total);
    expect(rows.map((m) => m.id)).toEqual(
      Array.from({ length: total }, (_, i) => total - i),
    );
  });

  it("returns an empty page without an index read when there is nothing older", async () => {
    mockIndex();
    const page = await chainMerchantMandatesPage(MERCHANT, MERCHANT, total, MERCHANT_MANDATE_PAGE_SIZE);
    expect(page).toEqual({ rows: [], total });
    expect(payflowMock.merchantMandates).not.toHaveBeenCalled();
  });

  it("normalises contract status so rows are not filtered by a raw array", async () => {
    mockIndex();
    const page = await chainMerchantMandatesPage(MERCHANT, MERCHANT, 0, 50);
    expect(page.rows.every((m) => m.status === "Active")).toBe(true);
  });
});
