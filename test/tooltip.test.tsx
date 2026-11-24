// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InfoTip, Tooltip } from "@/components/Tooltip";

/**
 * The inline help tooltip (issue #385): it opens on hover and on keyboard
 * focus, stays open while hovered, closes on Escape, is tied to its trigger
 * for screen readers, and has nothing to show when it has nothing to say.
 */

afterEach(cleanup);

function tooltip() {
  return screen.getByRole("tooltip", { hidden: true });
}

describe("Tooltip", () => {
  it("is hidden until its trigger is hovered or focused", () => {
    render(<Tooltip content="Charged once per period">Monthly</Tooltip>);
    expect(tooltip().hidden).toBe(true);

    const trigger = screen.getByText("Monthly");
    fireEvent.focus(trigger);
    expect(tooltip().hidden).toBe(false);
    fireEvent.blur(trigger);
    expect(tooltip().hidden).toBe(true);

    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    expect(tooltip().hidden).toBe(false);
    fireEvent.mouseLeave(trigger.parentElement as HTMLElement);
    expect(tooltip().hidden).toBe(true);
  });

  it("is reachable with Tab and described by the tooltip text", () => {
    render(<Tooltip content="Charged once per period">Monthly</Tooltip>);
    const trigger = screen.getByText("Monthly");
    expect(trigger.tabIndex).toBe(0);
    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip().id);
    expect(tooltip().textContent).toBe("Charged once per period");
  });

  it("stays open while the pointer moves onto the tooltip itself", () => {
    render(<Tooltip content="Charged once per period">Monthly</Tooltip>);
    const wrapper = screen.getByText("Monthly").parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    // The tooltip sits inside the wrapper, so hovering it is still hovering
    // the wrapper and fires no mouseleave.
    fireEvent.mouseEnter(tooltip());
    expect(tooltip().hidden).toBe(false);
  });

  it("closes on Escape without moving focus", () => {
    render(<Tooltip content="Charged once per period">Monthly</Tooltip>);
    const trigger = screen.getByText("Monthly");
    trigger.focus();
    fireEvent.focus(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tooltip().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("renders just the trigger when there is nothing to explain", () => {
    render(<Tooltip content="">Monthly</Tooltip>);
    expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull();
    expect(screen.getByText("Monthly").tabIndex).toBe(-1);
  });

  it("keeps a duplicate out of the accessibility tree when the trigger already says it", () => {
    render(<Tooltip content="19 Oct 2026, 14:05" announce={false}>in 3 days</Tooltip>);
    expect(screen.getByText("in 3 days").hasAttribute("aria-describedby")).toBe(false);
    expect(tooltip().getAttribute("aria-hidden")).toBe("true");
  });

  it("uses the theme tokens rather than fixed colours", () => {
    render(<Tooltip content="Charged once per period">Monthly</Tooltip>);
    expect(tooltip().className).toContain("bg-panel");
    expect(tooltip().className).toContain("text-fg");
    expect(tooltip().className).toContain("border-edge");
  });
});

describe("InfoTip", () => {
  it("is a labelled button described by its explanation, toggled by a press", () => {
    render(<InfoTip label="About the protocol fee">The protocol takes 1% of every charge.</InfoTip>);
    const button = screen.getByRole("button", { name: "About the protocol fee" });
    expect(button.getAttribute("aria-describedby")).toBe(tooltip().id);
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    expect(tooltip().hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button);
    expect(tooltip().hidden).toBe(true);
  });

  it("renders nothing without an explanation", () => {
    const { container } = render(<InfoTip label="About the fee">{null}</InfoTip>);
    expect(container.innerHTML).toBe("");
  });
});

