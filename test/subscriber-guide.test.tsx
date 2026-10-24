// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SubscriberGuide } from "@/components/SubscriberGuide";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("subscriber guide", () => {
  it("shows the three steps without blocking the page on a first visit", () => {
    render(<SubscriberGuide />);

    expect(screen.getByRole("heading", { name: "How subscriptions work" })).toBeTruthy();
    expect(screen.getByText("Fund your vault")).toBeTruthy();
    expect(screen.getByText("Authorize a mandate")).toBeTruthy();
    expect(screen.getByText("Cancel any time")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("remembers skipping and lets the visitor reopen the guide", () => {
    const view = render(<SubscriberGuide />);

    fireEvent.click(screen.getByRole("button", { name: "Skip guide" }));
    expect(localStorage.getItem("payflow.subscriber-guide.seen")).toBe("true");
    expect(screen.queryByRole("list")).toBeNull();

    view.unmount();
    render(<SubscriberGuide />);
    expect(screen.queryByRole("list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show guide" }));
    expect(screen.getByText("Fund your vault")).toBeTruthy();
  });
});