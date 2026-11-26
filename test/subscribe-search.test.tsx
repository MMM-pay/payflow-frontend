// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubscribePage from "@/app/subscribe/page";
import type { ApiPlan } from "@/lib/api";

const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const apiMock = vi.hoisted(() => ({ plans: vi.fn(), planStats: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/wallet", () => ({
  useWallet: () => ({
    address: "GSUBSCRIBER",
    networkMismatch: false,
    signXdr: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/token", () => ({
  useTokenMetas: () => new Map(),
  metaFor: (_metas: Map<string, unknown>, id: string) =>
    id === USDC
      ? { symbol: "USDC", decimals: 6 }
      : { symbol: "XLM", decimals: 7 },
}));

function makePlan(
  id: number,
  name: string,
  token: string,
  active = 1,
): ApiPlan {
  return {
    id,
    merchant: "GMERCHANT",
    name,
    token,
    amount: "10000000",
    period: 2_592_000,
    active,
    ledger: 100,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.plans.mockResolvedValue({
    plans: [
      makePlan(1, "Daily Coffee", XLM),
      makePlan(2, "Monthly Software", XLM),
      makePlan(3, "USDC Storage", USDC),
    ],
  });
});

afterEach(cleanup);

describe("Subscribe page plan search and token filter (#300)", () => {
  it("renders the search field and a token filter for the available tokens", async () => {
    render(<SubscribePage />);
    await screen.findByText("Daily Coffee");

    expect(screen.getByLabelText("Search plans by name")).toBeTruthy();
    const token = screen.getByLabelText("Token:") as HTMLSelectElement;
    expect(token.value).toBe("all");
    expect(screen.getByRole("option", { name: "XLM" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "USDC" })).toBeTruthy();
  });

  it("filters by name case-insensitively", async () => {
    render(<SubscribePage />);
    await screen.findByText("Daily Coffee");

    fireEvent.change(screen.getByLabelText("Search plans by name"), {
      target: { value: "software" },
    });

    expect(screen.getByText("Monthly Software")).toBeTruthy();
    expect(screen.queryByText("Daily Coffee")).toBeNull();
    expect(screen.queryByText("USDC Storage")).toBeNull();
  });

  it("filters by token and combines it with the name search", async () => {
    render(<SubscribePage />);
    await screen.findByText("USDC Storage");

    fireEvent.change(screen.getByLabelText("Token:"), {
      target: { value: USDC },
    });
    expect(screen.getByText("USDC Storage")).toBeTruthy();
    expect(screen.queryByText("Daily Coffee")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search plans by name"), {
      target: { value: "coffee" },
    });
    expect(await screen.findByText("No plans match this filter")).toBeTruthy();
  });

  it("offers a reset that clears search and token filters", async () => {
    render(<SubscribePage />);
    await screen.findByText("Daily Coffee");

    fireEvent.change(screen.getByLabelText("Search plans by name"), {
      target: { value: "nothing" },
    });
    expect(await screen.findByText("No plans match this filter")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));

    expect(await screen.findByText("Daily Coffee")).toBeTruthy();
    expect(
      (screen.getByLabelText("Search plans by name") as HTMLInputElement).value,
    ).toBe("");
    expect((screen.getByLabelText("Token:") as HTMLSelectElement).value).toBe("all");
  });

  it("keeps the loading state until the catalogue arrives", async () => {
    let resolve: (value: { plans: ApiPlan[] }) => void = () => {};
    apiMock.plans.mockReturnValue(new Promise((done) => (resolve = done)));

    render(<SubscribePage />);
    expect(screen.getByRole("status")).toBeTruthy();

    resolve({ plans: [makePlan(1, "Late Plan", XLM)] });
    await waitFor(() => expect(screen.getByText("Late Plan")).toBeTruthy());
  });
});
