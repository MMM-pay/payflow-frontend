// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TxLink } from "@/components/ui";

/**
 * A settled transaction's hash must be readable, copyable as the full value,
 * and one click away from the explorer. These tests pin the accessible name,
 * the empty state, and the clipboard feedback (issue #366).
 */

const HASH = "0123456789abcdef".repeat(4);

const { explorerBase } = vi.hoisted(() => ({
  explorerBase: "https://stellar.expert/explorer/testnet",
}));
const EXPLORER = explorerBase;

vi.mock("@/lib/config", () => ({ explorerBase }));

const writeText = vi.fn<() => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("TxLink", () => {
  it("links the shortened hash to the explorer and names the full hash", () => {
    render(<TxLink hash={HASH} />);

    const link = screen.getByRole("link", {
      name: `View transaction ${HASH} on the Stellar explorer (opens in a new tab)`,
    });
    expect(link.getAttribute("href")).toBe(`${EXPLORER}/tx/${HASH}`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    // The displayed value is shortened, so the tooltip carries the full hash.
    expect(link.getAttribute("title")).toBe(HASH);
    expect(link.textContent).toBe("01234567…89abcdef");
  });

  it("copies the full hash, not the shortened text", async () => {
    render(<TxLink hash={HASH} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy transaction hash" }));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(HASH);
    expect(screen.getByRole("status").textContent).toBe(
      "transaction hash copied to clipboard",
    );
  });

  it("announces a clipboard failure instead of failing silently", async () => {
    // jsdom has no async clipboard success and no execCommand fallback.
    writeText.mockRejectedValue(new Error("denied"));

    render(<TxLink hash={HASH} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy transaction hash" }));
    });

    expect(screen.getByRole("status").textContent).toBe(
      "Could not copy the transaction hash",
    );
  });

  it("renders nothing when there is no hash to show", () => {
    const { container } = render(<TxLink hash="   " />);
    expect(container.firstChild).toBeNull();
  });
});
