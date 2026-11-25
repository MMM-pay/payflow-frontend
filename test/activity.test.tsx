// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Activity } from "@/components/Activity";
import { useStream } from "@/lib/stream";

const wallet = vi.hoisted(() => ({
  address: "G-A" as string | null,
  setAddress: null as ((address: string | null) => void) | null,
}));
const apiMock = vi.hoisted(() => ({
  // The feed asks whether an indexer is configured before reading.
  isConfigured: () => true,
  mandatesOf: vi.fn(),
  mandatesFor: vi.fn(),
  timeline: vi.fn(),
  stream: vi.fn(),
}));

vi.mock("@/lib/wallet", async () => {
  const React = await import("react");
  return {
    useWallet: () => {
      const [address, setAddress] = React.useState(wallet.address);
      wallet.setAddress = setAddress;
      return { address };
    },
  };
});
vi.mock("@/lib/config", () => ({ config: { apiConfigured: true } }));
vi.mock("@/lib/api", () => ({ api: apiMock }));

class MockEventSource {
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  close = vi.fn();

  emit(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

function onlyStreamSource(): MockEventSource {
  const source = streamSources[0];
  if (!source) throw new Error("Expected an EventSource connection");
  return source;
}

function StreamDriver({ address = "G-A" }: { address?: string } = {}) {
  useStream({ address, role: "subscriber", onEvent: () => {} });
  return null;
}

function mandate(id: number) {
  return { id };
}

function event(
  eventId: string,
  mandateId: number,
  ledger: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    event_id: eventId,
    mandate_id: mandateId,
    type: "charged",
    ledger,
    amount: "1000000",
    token: "C_TOKEN",
    token_symbol: "USDC",
    token_decimals: 6,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  wallet.address = "G-A";
  wallet.setAddress = null;
  apiMock.mandatesOf.mockReset();
  apiMock.mandatesFor.mockReset();
  apiMock.timeline.mockReset();
  apiMock.stream.mockReset();
  const sources: MockEventSource[] = [];
  apiMock.stream.mockImplementation(() => {
    const source = new MockEventSource();
    sources.push(source);
    return source;
  });
  streamSources = sources;
  apiMock.mandatesOf.mockResolvedValue({ mandates: [mandate(1)] });
  apiMock.mandatesFor.mockResolvedValue({ mandates: [mandate(2)] });
  apiMock.timeline.mockImplementation(async (id: number) => ({
    events: [event(`event-${id}`, id, id)],
  }));
});

afterEach(cleanup);

let streamSources: MockEventSource[] = [];

describe("Activity", () => {
  it("shows a genuine empty state only when both mandate sources are empty", async () => {
    apiMock.mandatesOf.mockResolvedValue({ mandates: [] });
    apiMock.mandatesFor.mockResolvedValue({ mandates: [] });
    render(<Activity />);

    expect(await screen.findByText("No activity yet.")).toBeTruthy();
    expect(screen.queryByText(/incomplete/)).toBeNull();
  });

  it("shows incomplete data instead of an empty claim when one mandate source fails", async () => {
    apiMock.mandatesOf.mockRejectedValue(new Error("subscriber unavailable"));
    apiMock.mandatesFor.mockResolvedValue({ mandates: [] });
    render(<Activity />);

    expect(await screen.findByText(/Some activity could not be loaded/)).toBeTruthy();
    expect(screen.queryByText("No activity yet.")).toBeNull();
    expect(screen.queryByText(/Activity is unavailable/)).toBeNull();
  });

  it("shows available activity with a warning when a mandate source fails", async () => {
    apiMock.mandatesOf.mockRejectedValue(new Error("subscriber unavailable"));
    apiMock.mandatesFor.mockResolvedValue({ mandates: [mandate(2)] });
    render(<Activity />);

    expect(await screen.findByText("Charged 1 USDC")).toBeTruthy();
    expect(screen.getByText(/Some activity could not be loaded/)).toBeTruthy();
  });

  it("includes both roles, deduplicates mandates/events, orders events, and formats known tokens", async () => {
    apiMock.mandatesFor.mockResolvedValue({ mandates: [mandate(1), mandate(2)] });
    apiMock.timeline.mockImplementation(async (id: number) => ({
      events: [
        event(`event-${id}`, id, 10, { event_index: 1 }),
        event(`event-${id}`, id, 10, { event_index: 1 }),
        event(`older-${id}`, id, 9, { amount: null }),
      ],
    }));
    render(<Activity />);

    expect((await screen.findAllByText("Charged 1 USDC")).length).toBe(2);
    expect(screen.getAllByText("Payment charged")).toHaveLength(2);
    expect(apiMock.timeline).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("New")).toHaveLength(4);
  });

  it("keeps same event IDs from different mandates as separate events", async () => {
    apiMock.timeline.mockImplementation(async (id: number) => ({
      events: [event("same-id", id, id)],
    }));
    render(<Activity />);

    expect((await screen.findAllByText("Charged 1 USDC")).length).toBe(2);
  });

  it("uses raw units without labelling an event as XLM when token metadata is absent", async () => {
    apiMock.timeline.mockResolvedValue({
      events: [event("raw", 1, 1, { token: null, token_symbol: null, token_decimals: null })],
    });
    render(<Activity />);

    expect(
      await screen.findByText("Charged 1000000 (smallest units; token metadata unavailable)"),
    ).toBeTruthy();
    expect(screen.queryByText(/XLM/)).toBeNull();
  });

  it("shows partial activity when one timeline fails", async () => {
    apiMock.timeline.mockImplementation(async (id: number) =>
      id === 1 ? null : { events: [event("good", 2, 2)] },
    );
    render(<Activity />);

    expect(await screen.findByText(/Some activity could not be loaded/)).toBeTruthy();
    expect(screen.getByText("Charged 1 USDC")).toBeTruthy();
  });

  it("shows an unavailable state when every timeline fails", async () => {
    apiMock.timeline.mockResolvedValue(null);
    render(<Activity />);

    expect(await screen.findByText(/Activity is unavailable right now/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("No activity yet.")).toBeNull();
  });

  it("persists read state across remounts and isolates wallets", async () => {
    const view = render(<Activity />);
    expect(await screen.findAllByText("New")).toHaveLength(2);
    screen.getByRole("button", { name: "Mark all read" }).click();
    await waitFor(() => expect(screen.queryAllByText("New")).toHaveLength(0));

    view.unmount();
    render(<Activity />);
    await waitFor(() => expect(screen.queryAllByText("New")).toHaveLength(0));

    act(() => wallet.setAddress?.("G-B"));
    expect(await screen.findAllByText("New")).toHaveLength(2);
  });

  it("hides the previous wallet activity immediately while the next wallet loads", async () => {
    const view = render(<Activity />);
    expect(await screen.findAllByText("New")).toHaveLength(2);
    expect(view.container.textContent).toContain("mandate #1");

    apiMock.mandatesOf.mockImplementation(
      () => new Promise(() => {}),
    );
    apiMock.mandatesFor.mockImplementation(
      () => new Promise(() => {}),
    );

    act(() => wallet.setAddress?.("G-B"));

    expect(view.container.textContent).not.toContain("mandate #1");
    expect(view.container.textContent).not.toContain("mandate #2");
  });
  it("ignores old wallet results after the new wallet has loaded and disconnects cleanly", async () => {
    let resolveOld: ((value: { mandates: unknown[] }) => void) | undefined;
    let mandateCalls = 0;
    apiMock.mandatesOf.mockImplementation(() => {
      mandateCalls += 1;
      return mandateCalls === 1
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve({ mandates: [] });
    });
    apiMock.mandatesFor.mockResolvedValue({ mandates: [] });
    const view = render(<Activity />);

    act(() => wallet.setAddress?.("G-B"));
    await waitFor(() => expect(apiMock.mandatesOf).toHaveBeenCalledTimes(2));
    resolveOld?.({ mandates: [mandate(99)] });
    await waitFor(() => expect(view.container.textContent).not.toContain("mandate #99"));

    act(() => wallet.setAddress?.(null));
    expect(view.container.textContent).toBe("");
  });

  it("keeps the newest refresh result when an older refresh resolves later", async () => {
    render(<Activity />);
    await waitFor(() => expect(apiMock.timeline).toHaveBeenCalledTimes(2));

    let resolveOld: ((value: unknown) => void) | undefined;
    let refreshCalls = 0;
    apiMock.timeline.mockImplementation((id: number) => {
      refreshCalls += 1;
      if (refreshCalls === 1) {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      if (refreshCalls === 2) return Promise.resolve({ events: [event("old", id, 1)] });
      return Promise.resolve({ events: [event("new", id, 99)] });
    });

    screen.getByRole("button", { name: "Refresh" }).click();
    screen.getByRole("button", { name: "Refresh" }).click();
    await waitFor(() => expect(screen.getAllByText(/ledger 99/).length).toBeGreaterThan(0));

    resolveOld?.({ events: [event("old", 1, 1)] });
    await waitFor(() => expect(screen.queryByText(/ledger 1/)).toBeNull());
  });

  it("refreshes the feed when the existing scoped stream delivers an event", async () => {
    render(
      <>
        <Activity />
        <StreamDriver />
      </>,
    );
    expect(await screen.findAllByText("New")).toHaveLength(2);
    expect(streamSources).toHaveLength(1);

    apiMock.timeline.mockImplementation(async (id: number) => ({
      events: [event(`live-${id}`, id, 99)],
    }));
    act(() => {
      onlyStreamSource().emit(JSON.stringify({
        type: "charge",
        mandate_id: 1,
        timestamp: 123,
        charge: { tx_hash: "tx", mandate_id: 1, amount: "1000000", fee: "0", charges_made: 1, ledger: 99 },
      }));
    });

    expect(await screen.findAllByText(/ledger 99/)).toHaveLength(2);
  });

  it("ignores malformed stream messages and unsubscribes the feed on unmount", async () => {
    const view = render(
      <>
        <Activity />
        <StreamDriver />
      </>,
    );
    expect(await screen.findAllByText("New")).toHaveLength(2);
    const source = onlyStreamSource();
    const initialTimelineCalls = apiMock.timeline.mock.calls.length;

    act(() => source.emit("{malformed"));
    expect(apiMock.timeline).toHaveBeenCalledTimes(initialTimelineCalls);

    view.unmount();
    apiMock.timeline.mockClear();
    act(() => {
      source.emit(JSON.stringify({
        type: "charge",
        mandate_id: 1,
        timestamp: 123,
        charge: { tx_hash: "tx", mandate_id: 1, amount: "1000000", fee: "0", charges_made: 1, ledger: 99 },
      }));
    });
    expect(apiMock.timeline).not.toHaveBeenCalled();
  });

  it("does not refresh the feed for a stream scoped to another wallet", async () => {
    render(
      <>
        <Activity />
        <StreamDriver address="G-B" />
      </>,
    );
    expect(await screen.findAllByText("New")).toHaveLength(2);
    const initialMandateCalls = apiMock.mandatesOf.mock.calls.length;

    act(() => {
      onlyStreamSource().emit(JSON.stringify({
        type: "charge",
        mandate_id: 1,
        timestamp: 123,
        charge: { tx_hash: "tx", mandate_id: 1, amount: "1000000", fee: "0", charges_made: 1, ledger: 99 },
      }));
    });

    expect(apiMock.mandatesOf).toHaveBeenCalledTimes(initialMandateCalls);
  });
});
