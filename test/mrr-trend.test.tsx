// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider, LOCALE_STORAGE_KEY } from "@/i18n/provider";
import { MrrTrendChart } from "@/components/MrrTrendChart";
import type { ApiMandate } from "@/lib/api";
import { MONTH_SECONDS } from "@/lib/mrr";

const META = { symbol: "XLM", decimals: 7 };
const NOW = Date.UTC(2026, 10, 15, 12) / 1000;

function mandate(overrides: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 1,
    subscriber: "GSUBSCRIBER",
    merchant: "GMERCHANT",
    plan_id: 1,
    amount: "10000000",
    period: MONTH_SECONDS,
    next_charge: 0,
    last_charge: Date.UTC(2026, 9, 15) / 1000,
    charges_made: 3,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
    ...overrides,
  };
}

function renderChart(mandates: ApiMandate[] | null) {
  return render(
    <I18nProvider>
      <MrrTrendChart mandates={mandates} meta={META} now={NOW} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("committed MRR chart", () => {
  it("announces loading instead of an empty chart", () => {
    renderChart(null);
    expect(screen.getByRole("status").textContent).toContain("Loading committed MRR");
  });

  it("explains mandate data it cannot read rather than plotting zeros", () => {
    renderChart([mandate({ amount: "not-a-number" })]);
    expect(
      screen.getByText(/Committed MRR could not be read from these subscriptions/),
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("explains an empty chart when nothing is committed yet", () => {
    renderChart([]);
    expect(screen.getByText("No committed MRR yet")).toBeTruthy();
    expect(
      screen.getByText(/A subscription adds its monthly-normalised amount here/),
    ).toBeTruthy();
  });

  it("draws the trend with an accessible name and the same figures in a table", () => {
    renderChart([
      mandate({ id: 1 }),
      mandate({
        id: 2,
        amount: "20000000",
        last_charge: Date.UTC(2026, 10, 5) / 1000,
        charges_made: 1,
      }),
    ]);

    expect(screen.getByText("Committed this month")).toBeTruthy();
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")).toContain("Committed MRR by month");
    expect(screen.getByText("Show committed MRR as a table")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    // The headline change and the final table row show the same figure.
    expect(screen.getAllByText("Up 2 XLM (200%)").length).toBeGreaterThan(0);
  });

  it("marks the series as an estimate when a start has to be inferred", () => {
    renderChart([
      mandate({ charges_made: 0, next_charge: Date.UTC(2026, 10, 20) / 1000 }),
    ]);
    expect(
      screen.getByText(/Estimated from mandate charge history/),
    ).toBeTruthy();
  });

  it("renders in German once the stored locale is restored", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "de");
    renderChart([mandate()]);
    expect(await screen.findByText("Diesen Monat gebunden")).toBeTruthy();
    expect(screen.getByText("Gebundene MRR als Tabelle anzeigen")).toBeTruthy();
    expect(screen.getByText(/Gebundene MRR pro Monat/)).toBeTruthy();
  });
});
