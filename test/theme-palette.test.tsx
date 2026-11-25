// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RevenueChart } from "@/components/RevenueChart";
import type { RevenuePoint } from "@/lib/revenue";

const DAY = 86_400;
const START = Math.floor(new Date("2026-10-01T00:00:00Z").getTime() / 1000);

function point(offsetDays: number, netXlm: number): RevenuePoint {
  const net = BigInt(Math.round(netXlm * 1e7));
  return { start: START + offsetDays * DAY, gross: net, fee: 0n, net };
}

afterEach(cleanup);

describe("theme palette tokens", () => {
  it("derives chart colours from CSS theme tokens, not hardcoded values", () => {
    render(
      <RevenueChart
        points={[point(0, 1), point(1, 2)]}
        size="day"
        meta={{ symbol: "XLM", decimals: 7 }}
      />,
    );
    const svg = screen.getByRole("img");
    const html = svg.outerHTML;
    // The chart must paint through the same CSS variables as the rest of the UI.
    expect(html).toContain("stroke-accent");
    expect(html).toContain("stroke-edge");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
