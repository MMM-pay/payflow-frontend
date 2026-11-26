// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { detectReducedData, useReducedData } from "@/lib/useReducedData";
import { QrCode } from "@/components/QrCode";
import { RevenueChart } from "@/components/RevenueChart";
import { CohortRetentionTable } from "@/components/CohortRetentionTable";
import { clearPriceCache, useXlmUsdPrice } from "@/lib/price";
import { clearTomlCache, useOrgName } from "@/lib/toml";

const apiMocks = vi.hoisted(() => ({
  merchantCohortRetention: vi.fn(async () => ({ merchant: "GABC", cohorts: [] })),
}));

vi.mock("@/lib/api", () => ({
  api: {
    isConfigured: () => true,
    merchantCohortRetention: apiMocks.merchantCohortRetention,
  },
}));

let reducedMedia = false;
let saveDataFlag = false;
const mediaListeners = new Set<() => void>();
const connListeners = new Set<() => void>();

function installMediaAndConnectionMocks() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-data: reduce)" ? reducedMedia : false,
      media: query,
      addEventListener: (_: string, cb: () => void) => mediaListeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => mediaListeners.delete(cb),
    })),
  });

  Object.defineProperty(navigator, "connection", {
    configurable: true,
    get: () => ({
      get saveData() {
        return saveDataFlag;
      },
      addEventListener: (_: string, cb: () => void) => connListeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => connListeners.delete(cb),
    }),
  });
}

beforeEach(() => {
  reducedMedia = false;
  saveDataFlag = false;
  mediaListeners.clear();
  connListeners.clear();
  clearPriceCache();
  clearTomlCache();
  apiMocks.merchantCohortRetention.mockClear();
  installMediaAndConnectionMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("prefers-reduced-data detection", () => {
  it("detects reduced-data from undefined window, media query, and Save-Data", () => {
    expect(detectReducedData(undefined)).toBe(false);
    expect(detectReducedData({})).toBe(false);
    expect(detectReducedData({ navigator: {} })).toBe(false);
    expect(detectReducedData({ matchMedia: null as unknown as typeof window.matchMedia })).toBe(false);
    expect(detectReducedData({ matchMedia: (() => null) as unknown as typeof window.matchMedia })).toBe(false);
    expect(detectReducedData({ navigator: { connection: { saveData: false } } })).toBe(false);
    expect(
      detectReducedData({
        matchMedia: () => ({ matches: true }),
      }),
    ).toBe(true);
    expect(
      detectReducedData({
        navigator: { connection: { saveData: true } },
      }),
    ).toBe(true);
  });

  it("syncs dynamically when prefers-reduced-data or Save-Data changes", () => {
    const { result } = renderHook(() => useReducedData());
    expect(result.current).toBe(false);

    act(() => {
      reducedMedia = true;
      mediaListeners.forEach((cb) => cb());
    });
    expect(result.current).toBe(true);

    act(() => {
      reducedMedia = false;
      mediaListeners.forEach((cb) => cb());
    });
    expect(result.current).toBe(false);

    act(() => {
      saveDataFlag = true;
      connListeners.forEach((cb) => cb());
    });
    expect(result.current).toBe(true);
  });
});

describe("reduced-data heavy asset deferral", () => {
  it("defers QrCode rendering until explicitly loaded via keyboard/button", () => {
    reducedMedia = true;
    render(<QrCode data="https://example.com/subscribe?plan=1" label="Pro plan QR" />);

    expect(document.querySelector("svg")).toBeNull();
    const region = screen.getByRole("region", { name: "Pro plan QR" });
    expect(region.textContent).toContain("QR code skipped to save data.");

    const button = screen.getByRole("button", { name: "Load QR code for Pro plan QR" });
    fireEvent.click(button);
    expect(screen.getByRole("img", { name: "Pro plan QR" })).toBeTruthy();
  });

  it("pauses RevenueChart SVG under Save-Data while keeping the accessible data table", () => {
    saveDataFlag = true;
    const points = [{ start: Date.UTC(2026, 0, 2) / 1000, gross: 100n, fee: 0n, net: 100n }];
    render(<RevenueChart points={points} size="day" meta={{ symbol: "XLM", decimals: 7 }} />);

    expect(document.querySelector("polyline")).toBeNull();
    expect(screen.getByText(/Chart graphic paused to save data/)).toBeTruthy();
    expect(screen.getByText("Show chart")).toBeTruthy();
    expect(screen.getByText("Show revenue as a table")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show chart" }));
    expect(document.querySelector("polyline")).toBeTruthy();
  });

  it("skips automatic CohortRetentionTable backend request until explicitly requested", async () => {
    reducedMedia = true;
    render(<CohortRetentionTable merchant="GABC" apiConfigured={true} />);

    expect(apiMocks.merchantCohortRetention).not.toHaveBeenCalled();
    expect(screen.getByText("Cohort retention paused to save data")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Load cohort retention" }));
    expect(apiMocks.merchantCohortRetention).toHaveBeenCalledWith("GABC");
    expect(await screen.findByText("No cohort data available")).toBeTruthy();
  });

  it("skips automatic oracle SDK fetch and stellar.toml lookup when reduced-data is active", () => {
    reducedMedia = true;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { result: priceResult } = renderHook(() => useXlmUsdPrice());
    expect(priceResult.current.skippedForReducedData).toBe(true);
    expect(priceResult.current.loading).toBe(false);

    const { result: orgResult } = renderHook(() =>
      useOrgName("GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU"),
    );
    expect(orgResult.current).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("includes prefers-reduced-data CSS media rule and Save-Data guard in sw.js", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
    expect(css).toContain("prefers-reduced-data: reduce");

    const sw = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
    expect(sw).toContain('request.headers.get("save-data") === "on"');
  });
});
