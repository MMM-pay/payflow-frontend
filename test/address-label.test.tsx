// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AddressLink } from "@/components/ui";
import { labelStorageKey } from "@/lib/labels";

/**
 * Issue #41: labels live in localStorage and appear wherever `AddressLink`
 * renders. These tests pin the two visible behaviours — add/edit/remove around
 * the address, and a page that still works when storage is blocked.
 */

const ADDRESS = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

async function addLabel(value: string) {
  fireEvent.click(screen.getByRole("button", { name: `Add a label for ${ADDRESS}` }));
  const input = screen.getByLabelText(`Label for ${ADDRESS}`);
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("AddressLink labels", () => {
  it("saves a label in localStorage and shows it beside the address", async () => {
    render(<AddressLink value={ADDRESS} />);

    await addLabel("  Alice   Co  ");

    expect(await screen.findByText("Alice Co")).toBeTruthy();
    expect(window.localStorage.getItem(labelStorageKey(ADDRESS))).toBe("Alice Co");
    // The label is text, not a replacement for the address: the explorer link
    // and copy button are still there.
    expect(screen.getByTitle(ADDRESS)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();
  });

  it("loads an existing label after a remount", async () => {
    window.localStorage.setItem(labelStorageKey(ADDRESS), "Landlord");
    render(<AddressLink value={ADDRESS} />);

    expect(await screen.findByText("Landlord")).toBeTruthy();
  });

  it("edits and removes a label", async () => {
    render(<AddressLink value={ADDRESS} />);
    await addLabel("Alice");

    fireEvent.click(
      await screen.findByRole("button", { name: `Edit your label for ${ADDRESS}` }),
    );
    const input = screen.getByLabelText(`Label for ${ADDRESS}`) as HTMLInputElement;
    expect(input.value).toBe("Alice");
    fireEvent.change(input, { target: { value: "Alicia" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Alicia")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Edit your label for ${ADDRESS}` }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.queryByText("Alicia")).toBeNull();
    expect(window.localStorage.getItem(labelStorageKey(ADDRESS))).toBeNull();
  });

  it("keeps working — and says so — when storage refuses writes", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });
    render(<AddressLink value={ADDRESS} />);

    await addLabel("Alice");

    expect(
      await screen.findByText("This browser is not allowing labels to be saved."),
    ).toBeTruthy();
    // The address link itself is unaffected.
    expect(screen.getByTitle(ADDRESS)).toBeTruthy();
    expect(screen.queryByText("Alice")).toBeNull();
  });
});
