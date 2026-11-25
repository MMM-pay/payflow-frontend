import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHART_FILL_CLASSES,
  CHART_PALETTE,
  CHART_PALETTE_SIZE,
  chartColor,
  chartFillClass,
} from "@/lib/chart-theme";

describe("chart palette", () => {
  it("exposes one stable token per series slot", () => {
    expect(CHART_PALETTE).toHaveLength(CHART_PALETTE_SIZE);
    expect([...CHART_PALETTE]).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
    ]);
  });

  it("wraps series indexes instead of returning undefined", () => {
    expect(chartColor(0)).toBe("var(--chart-1)");
    expect(chartColor(5)).toBe("var(--chart-1)");
    expect(chartColor(-1)).toBe("var(--chart-5)");
    expect(chartColor(12)).toBe("var(--chart-3)");
  });

  it("uses literal Tailwind classes so the scanner emits them", () => {
    expect(chartFillClass(0)).toBe("bg-chart-1/15 text-chart-1");
    expect(chartFillClass(9)).toBe("bg-chart-5/15 text-chart-5");
    for (const className of CHART_FILL_CLASSES) {
      expect(className).toMatch(/^bg-chart-[1-5]\/15 text-chart-[1-5]$/);
    }
  });

  it("defines the tokens for the system preference and both manual themes", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../src/app/globals.css", import.meta.url)),
      "utf8",
    );
    for (let slot = 1; slot <= CHART_PALETTE_SIZE; slot += 1) {
      expect(css.match(new RegExp(`--chart-${slot}:`, "g"))).toHaveLength(3);
    }
  });
});
