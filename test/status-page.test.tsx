// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import StatusPage from "@/app/status/page";

/**
 * The acceptance criterion for the status page is that each check fails
 * independently: an RPC outage must still show the indexer's state, and a
 * dead backend must still show the RPC ledger. These tests pin that by
 * resolving each mocked check differently and asserting every card keeps its
 * own verdict — plus the contract-only case, where "no backend" is a
 * deployment choice and must read as "Not configured", not as an outage.
 */

const mocks = vi.hoisted(() => ({
  getHealth: vi.fn(),
  isConfigured: vi.fn(() => true),
  health: vi.fn(),
  keeper: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    isConfigured: () => mocks.isConfigured(),
    health: () => mocks.health(),
    keeper: () => mocks.keeper(),
  },
}));

vi.mock("@/lib/payflow", () => ({
  server: { getHealth: () => mocks.getHealth() },
}));

const HEALTH_BODY = {
  status: "ok",
  network: "testnet",
  indexer: {
    cursor: 1000,
    latestLedger: 1010,
    lag: 10,
    paused: false,
    freshnessSeconds: 42,
    lastRunAt: "2025-06-15T15:06:40.000Z",
    lastError: null,
  },
};

const KEEPER_BODY = {
  passes: [
    {
      time: 1_750_000_000,
      attempted: 2,
      settled: 2,
      failures: [],
      backoff: [],
    },
  ],
};

beforeEach(() => {
  mocks.isConfigured.mockReturnValue(true);
  mocks.getHealth.mockResolvedValue({ latestLedger: 987_654, status: "healthy" });
  mocks.health.mockResolvedValue(HEALTH_BODY);
  mocks.keeper.mockResolvedValue(KEEPER_BODY);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderAndWait() {
  render(<StatusPage />);
  // The overall banner appears only once every check has answered.
  await screen.findByText(/Overall:/);
}

describe("status page", () => {
  it("shows all three checks operational when everything answers", async () => {
    await renderAndWait();

    expect(screen.getAllByText("Operational")).toHaveLength(3);
    expect(screen.getByText("987654")).toBeTruthy();
    expect(screen.getByText("ok")).toBeTruthy();
    expect(screen.getByText("10 ledgers")).toBeTruthy();
    // The keeper's last pass is rendered from Unix seconds.
    expect(screen.getByText(/Tried \/ settled/)).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });

  it("keeps the indexer and keeper cards when RPC is down", async () => {
    mocks.getHealth.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8000"));

    await renderAndWait();

    expect(screen.getByText("Down")).toBeTruthy();
    expect(screen.getByText(/ECONNREFUSED/)).toBeTruthy();
    // The other two cards still carry their own verdicts — the whole point.
    const operational = screen.getAllByText("Operational");
    expect(operational).toHaveLength(2);
    expect(screen.getByText("10 ledgers")).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();
    expect(screen.getByText(/Overall: down/)).toBeTruthy();
  });

  it("keeps the RPC card when the backend is down", async () => {
    mocks.health.mockResolvedValue(null);
    mocks.keeper.mockResolvedValue(null);

    await renderAndWait();

    expect(screen.getByText(/did not answer \/health/)).toBeTruthy();
    // RPC still reports its ledger.
    expect(screen.getByText("987654")).toBeTruthy();
    // Keeper shows the honest "cannot say", not an invented outage.
    expect(screen.getByText(/keeper is probably off/)).toBeTruthy();
    expect(screen.getByText(/Overall: down/)).toBeTruthy();
  });

  it("reads contract-only mode as not configured, not as an outage", async () => {
    // NEXT_PUBLIC_API_URL empty: no backend exists, so the two backend checks
    // are skipped and only RPC decides the overall verdict.
    mocks.isConfigured.mockReturnValue(false);
    mocks.health.mockResolvedValue(null);
    mocks.keeper.mockResolvedValue(null);

    await renderAndWait();

    expect(screen.getAllByText("Not configured")).toHaveLength(2);
    expect(screen.getByText(/contract-only mode/)).toBeTruthy();
    expect(screen.getByText("987654")).toBeTruthy();
    expect(screen.getByText(/Overall: operational/)).toBeTruthy();
    // That no request is issued at all in this mode is pinned one layer down,
    // in api.test.ts — the real api.health/keeper short-circuit on
    // isConfigured() before fetching. Here the mocks always "fetch", and the
    // page must still render the checks as skipped, not down.
  });

  it("flags a keeper pass that had failures as degraded", async () => {
    mocks.keeper.mockResolvedValue({
      passes: [
        {
          time: 1_750_000_000,
          attempted: 3,
          settled: 2,
          failures: [{ mandateId: 7, error: "The subscriber's vault does not hold enough." }],
          backoff: [],
        },
      ],
    });

    await renderAndWait();

    expect(screen.getByText("Degraded")).toBeTruthy();
    expect(screen.getByText("3 / 2")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText(/retries with backoff/)).toBeTruthy();
    // RPC and indexer are unaffected by the keeper's failure.
    expect(screen.getAllByText("Operational")).toHaveLength(2);
  });

  it("re-checks every dependency when the button is pressed", async () => {
    await renderAndWait();
    expect(mocks.getHealth).toHaveBeenCalledTimes(1);

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: /re-check/i }));

    await vi.waitFor(() => {
      expect(mocks.getHealth).toHaveBeenCalledTimes(2);
      expect(mocks.health).toHaveBeenCalledTimes(2);
      expect(mocks.keeper).toHaveBeenCalledTimes(2);
    });
  });
});
