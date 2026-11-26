// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/provider";
import { Pagination } from "@/components/Pagination";
import { cursorPage, TABLE_PAGE_SIZE } from "@/lib/pagination";

afterEach(cleanup);

describe("cursor pagination", () => {
  it("slices API-style offset pages and clamps cursors after data shrinks", () => {
    const items = Array.from({ length: 25 }, (_, index) => index);
    expect(cursorPage(items, 10)).toEqual(items.slice(10, 20));
    expect(cursorPage(items, 500)).toEqual(items.slice(20));
    expect(cursorPage(items, -10)).toEqual(items.slice(0, TABLE_PAGE_SIZE));
  });

  it("moves by the requested limit and disables controls at the boundaries", () => {
    const onCursorChange = vi.fn();
    render(
      <I18nProvider>
        <Pagination
          cursor={10}
          limit={10}
          total={25}
          onCursorChange={onCursorChange}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Showing 11–20 of 25")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onCursorChange.mock.calls).toEqual([[0], [20]]);
  });

  it("hides controls for one page and disables them while loading", () => {
    const onCursorChange = vi.fn();
    const { rerender } = render(
      <I18nProvider>
        <Pagination cursor={0} limit={10} total={10} onCursorChange={onCursorChange} />
      </I18nProvider>,
    );
    expect(screen.queryByRole("navigation", { name: "Table pagination" })).toBeNull();

    rerender(
      <I18nProvider>
        <Pagination
          cursor={0}
          limit={10}
          total={11}
          onCursorChange={onCursorChange}
          loading
        />
      </I18nProvider>,
    );
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
