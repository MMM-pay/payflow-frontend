// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AddressDisplay } from "@/components/AddressDisplay";
import { explorerAddressUrl, truncateAddress } from "@/lib/address";

const clipboard = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: clipboard.copy }));

const ACCOUNT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";
const CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddressDisplay", () => {
  it("truncates with defaults and configurable prefix/suffix lengths", () => {
    expect(truncateAddress(ACCOUNT)).toBe("GCH5VH…3MHU");
    expect(truncateAddress("abcdefgh", 2, 2)).toBe("ab…gh");
    expect(truncateAddress("short", 2, 2)).toBe("short");
    expect(truncateAddress("abcdefgh", 3, 0)).toBe("abc…");
  });

  it("links only valid addresses through the configured Stellar Expert network", () => {
    expect(explorerAddressUrl(ACCOUNT)).toBe(
      `https://stellar.expert/explorer/testnet/account/${ACCOUNT}`,
    );
    expect(explorerAddressUrl(CONTRACT, "contract")).toContain(
      `/explorer/testnet/contract/${CONTRACT}`,
    );
    expect(explorerAddressUrl(ACCOUNT, "account", "https://stellar.expert/explorer/public")).toContain(
      "/explorer/public/account/",
    );
    expect(explorerAddressUrl("not-an-address")).toBeNull();
    expect(explorerAddressUrl(ACCOUNT, "contract")).toBeNull();
    expect(explorerAddressUrl(ACCOUNT, "account", "https://evil.example/explorer/testnet")).toBeNull();
    expect(explorerAddressUrl(ACCOUNT, "account", "http://stellar.expert/explorer/testnet")).toBeNull();
  });

  it("shows a full accessible name, allows copying, and announces success", async () => {
    clipboard.copy.mockResolvedValue(true);
    render(<AddressDisplay value={ACCOUNT} />);

    expect(screen.getByRole("link", { name: ACCOUNT }).getAttribute("href")).toContain(ACCOUNT);
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("copied to clipboard"));
    expect(clipboard.copy).toHaveBeenCalledWith(ACCOUNT);
  });

  it("does not link invalid values and announces copy failure", async () => {
    clipboard.copy.mockResolvedValue(false);
    render(<AddressDisplay value="invalid address" />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("invali…ress")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Could not copy"));
  });

  it("handles absent addresses without rendering a copy action", () => {
    render(<AddressDisplay value="  " />);
    expect(screen.getByLabelText("Address unavailable").textContent).toBe("—");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
