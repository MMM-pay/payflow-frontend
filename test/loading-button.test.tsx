// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { LoadingButton } from "@/components/LoadingButton";

/**
 * A loading button (issue #413): it reports that work is running, cannot be
 * submitted twice while it runs, and becomes usable again once the action
 * settles. The double-click case is the point — React applies `disabled` on
 * the next render, so the component also guards synchronously.
 */

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A stateful parent, so the real busy → idle transition is exercised. */
function Harness({ onRun }: { onRun: (finish: () => void) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <LoadingButton
      loading={busy}
      loadingText="Saving…"
      onClick={async () => {
        setBusy(true);
        try {
          await onRun(() => setBusy(false));
        } finally {
          setBusy(false);
        }
      }}
    >
      Save changes
    </LoadingButton>
  );
}

describe("LoadingButton", () => {
  it("shows the label and is not busy by default", () => {
    render(<LoadingButton>Save changes</LoadingButton>);
    const button = screen.getByRole("button", { name: "Save changes" });
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits once even when clicked twice before the busy render", async () => {
    const pending = deferred<void>();
    let calls = 0;
    render(
      <LoadingButton
        onClick={() => {
          calls += 1;
          return pending.promise;
        }}
      >
        Pay now
      </LoadingButton>,
    );

    const button = screen.getByRole("button", { name: "Pay now" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(calls).toBe(1);

    await act(async () => {
      pending.resolve();
    });
  });

  it("uses loading text, aria-busy and a disabled control while running", () => {
    render(
      <LoadingButton loading loadingText="Depositing…">
        Deposit
      </LoadingButton>,
    );
    const button = screen.getByRole("button", { name: /Depositing…/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    // The spinner is decorative; the state is announced in words as well.
    expect(button.textContent).toContain("Working…");
  });

  it("accepts a second click after the first action settles", async () => {
    const runs: Array<() => void> = [];
    render(<Harness onRun={(finish) => promiseFrom(runs, finish)} />);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("button", { name: /Saving…/ })).toBeTruthy();

    await act(async () => {
      runs[0]!();
      await Promise.resolve();
    });

    const button = await screen.findByRole("button", { name: "Save changes" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: /Saving…/ })).toBeTruthy();
  });
});

/** Keeps the resolver for each run so the test controls when it settles. */
function promiseFrom(runs: Array<() => void>, finish: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    runs.push(() => {
      finish();
      resolve();
    });
  });
}
