// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/StatusBadge";

afterEach(cleanup);

describe("StatusBadge", () => {
  it("renders the translated label for every mandate state", () => {
    render(
      <div>
        <StatusBadge status="Active" />
        <StatusBadge status="Paused" />
        <StatusBadge status="Cancelled" />
        <StatusBadge status="Completed" />
      </div>,
    );
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("renders the translated label for plan states", () => {
    render(
      <div>
        <StatusBadge status="Active" />
        <StatusBadge status="Paused" />
      </div>,
    );
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
  });

  it("applies the semantic colour for each known state", () => {
    const cases: Array<[string, string]> = [
      ["Active", "bg-accent/15 text-accent"],
      ["Paused", "bg-warn/15 text-warn"],
      ["Cancelled", "bg-danger/15 text-danger"],
      ["Completed", "bg-info/15 text-info"],
    ];
    for (const [status, tone] of cases) {
      const { container } = render(<StatusBadge status={status} />);
      const badge = container.firstChild as HTMLElement;
      expect(badge.className).toContain(tone);
    }
  });

  it("falls back to a neutral tone and the raw value for unknown states", () => {
    const { container } = render(<StatusBadge status="NotARealState" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.textContent).toBe("NotARealState");
    expect(badge.className).toContain("bg-fg/10 text-soft");
    expect(badge.className).not.toContain("text-accent");
    expect(badge.className).not.toContain("text-danger");
  });

  it("supports an explicit label override while keeping the state tone", () => {
    const { container } = render(
      <StatusBadge status="Active" label="Now live" />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.textContent).toBe("Now live");
    expect(badge.className).toContain("bg-accent/15 text-accent");
  });

  it("conveys meaning through text, not colour alone", () => {
    const { container } = render(<StatusBadge status="Cancelled" />);
    const badge = container.firstChild as HTMLElement;
    // The visible text names the state, so the meaning survives greyscale.
    expect(badge.textContent).toMatch(/cancelled/i);
    expect(badge.getAttribute("role")).toBeNull();
  });
});
