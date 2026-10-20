// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { RevenueChart } from "@/components/RevenueChart";
import type { RevenuePoint } from "@/lib/revenue";

/**
 * A chart that no one can see must still be readable: the accessible name
 * summarises range, total and peak, and the same figures are available as a
 * real table behind a disclosure. Every number on the page matches what the
 * line encodes, because both are bigint from the API to the pixel.
 */

const DAY = 86_400;
const START = Math.floor(new Date("2026-10-01T00:00:00Z").getTime() / 1000);

function point(offsetDays: number, netXlm: number): RevenuePoint {
  const net = BigInt(Math.round(netXlm * 1e7));
  return {
    start: START + offsetDays * DAY,
    gross: net * 100n,
    fee: net / 100n,
    net,
  };
}

const series = [point(0, 1), point(1, 4), point(2, 2), point(3, 3)];

afterEach(cleanup);

describe("RevenueChart", () => {
  it("names the series in its accessible summary", () => {
    render(
      <RevenueChart points={series} size="day" meta={{ symbol: "XLM", decimals: 7 }} />,
    );
    const img = screen.getByRole("img");
    const label = img.getAttribute("aria-label") ?? "";
    expect(label).toContain("Net revenue by day");
    expect(label).toContain("total 10 XLM");
    expect(label).toContain("peak 4 XLM");
  });

  it("draws a point per bucket", () => {
    render(
      <RevenueChart points={series} size="day" meta={{ symbol: "XLM", decimals: 7 }} />,
    );
    const img = screen.getByRole("img");
    const polyline = img.ownerDocument.querySelector("polyline");
    expect(polyline).toBeTruthy();
    const points = polyline!.getAttribute("points") ?? "";
    expect(points.split(" ")).toHaveLength(series.length);
  });

  it("draws no line for an empty series and says so accessibly", () => {
    render(<RevenueChart points={[]} size="day" meta={{ symbol: "XLM", decimals: 7 }} />);
    const img = screen.getByRole("img");
    const polyline = img.ownerDocument.querySelector("polyline");
    expect(polyline).toBeNull();
    const label = img.getAttribute("aria-label") ?? "";
    expect(label).toContain("No revenue recorded in this period.");
  });

  it("offers the same figures as a real table", () => {
    render(
      <RevenueChart points={series} size="day" meta={{ symbol: "XLM", decimals: 7 }} />,
    );
    const summary = screen.getByText("Show revenue as a table");
    // jsdom does not implement the <details> click toggle, so open it directly.
    const details = summary.parentElement as HTMLDetailsElement;
    details.open = true;
    expect(screen.getByRole("table")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByText("1 Oct")).toBeTruthy();
    expect(within(table).getByText("4 Oct")).toBeTruthy();
    expect(within(table).getByText("4 XLM")).toBeTruthy();
    expect(within(table).getByText("10 XLM")).toBeTruthy();
  });
});