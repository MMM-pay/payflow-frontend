// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Search } from "@/components/Search";

afterEach(cleanup);

describe("Search component (#300)", () => {
  it("exposes a labelled search field with the current value", () => {
    render(<Search value="coffee" onChange={() => {}} />);

    const input = screen.getByLabelText("Search plans") as HTMLInputElement;
    expect(input.type).toBe("search");
    expect(input.value).toBe("coffee");
    expect(screen.getByRole("search")).toBeTruthy();
  });

  it("reports each keystroke to the caller", () => {
    const onChange = vi.fn();
    render(<Search value="" onChange={onChange} label="Search plans by name" />);

    fireEvent.change(screen.getByLabelText("Search plans by name"), {
      target: { value: "annual" },
    });
    expect(onChange).toHaveBeenCalledWith("annual");
  });

  it("offers a keyboard-reachable clear button only when there is text", () => {
    const { rerender } = render(<Search value="" onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

    const onChange = vi.fn();
    rerender(<Search value="coffee" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("accepts a custom id so a page can label it independently", () => {
    render(<Search id="plans-search" value="" onChange={() => {}} />);
    expect(document.getElementById("plans-search")).toBeTruthy();
    expect(screen.getByLabelText("Search plans").id).toBe("plans-search");
  });
});
