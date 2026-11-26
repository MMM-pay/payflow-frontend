// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GracePeriodBadge } from "@/components/GracePeriodBadge";

/**
 * The grace-period badge (issue #392) says how long a past-due subscriber has
 * left, in words as well as colour, and nothing when there is no window.
 */

afterEach(cleanup);

const now = Date.UTC(2026, 10, 25, 12, 0) / 1000;

function badge() {
  return document.querySelector("[data-grace]") as HTMLElement | null;
}

describe("GracePeriodBadge", () => {
  it("says when the grace period ends, in the warning tone", () => {
    render(<GracePeriodBadge until={now + 3 * 86_400} now={now * 1000} />);
    expect(badge()?.textContent).toContain("Grace period ends");
    expect(badge()?.textContent).toContain("in 3 days");
    expect(badge()?.dataset.grace).toBe("open");
    expect(badge()?.className).toContain("text-warn");
  });

  it("switches to the danger tone in the last day", () => {
    render(<GracePeriodBadge until={now + 5 * 3600} now={now * 1000} />);
    expect(badge()?.textContent).toContain("in 5 hours");
    expect(badge()?.dataset.grace).toBe("urgent");
    expect(badge()?.className).toContain("text-danger");
  });

  it("says the grace period has ended once it has", () => {
    render(<GracePeriodBadge until={now - 2 * 3600} now={now * 1000} />);
    expect(badge()?.textContent).toContain("Grace period ended");
    expect(badge()?.textContent).toContain("2 hours ago");
    expect(badge()?.dataset.grace).toBe("ended");
  });

  it("puts the exact end time in a tooltip", () => {
    render(<GracePeriodBadge until={now + 3 * 86_400} now={now * 1000} />);
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toContain("2026");
  });

  it("renders nothing when the contract does not report a grace period", () => {
    const { container } = render(<GracePeriodBadge until={null} now={now * 1000} />);
    expect(container.innerHTML).toBe("");
  });
});
