// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscountForm } from "@/components/DiscountForm";
import { XLM } from "@/lib/format";

/**
 * A merchant is told what a discount does to the subscriber before signing,
 * when it could end the mandate (issue #396), and has to confirm it.
 */

afterEach(cleanup);

function setup(props: { amount?: bigint; maxCharges?: number; chargesMade?: number } = {}) {
  const onApply = vi.fn();
  render(
    <DiscountForm
      amount={props.amount ?? 10_000_000n}
      meta={XLM}
      busy={false}
      maxCharges={props.maxCharges ?? 0}
      chargesMade={props.chargesMade ?? 0}
      onCancel={() => {}}
      onApply={onApply}
    />,
  );
  const set = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const apply = () => fireEvent.click(screen.getByRole("button", { name: "Apply discount" }));
  return { onApply, set, apply };
}

describe("DiscountForm subscriber impact", () => {
  it("applies an ordinary discount straight away, with no warning", () => {
    const { onApply, apply } = setup();
    expect(screen.queryByText(/Check the subscriber impact/)).toBeNull();
    apply();
    expect(onApply).toHaveBeenCalledWith(1000, 3);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("warns when the discount outlasts the mandate's charge cap, and asks to confirm", () => {
    const { onApply, set, apply } = setup({ maxCharges: 6, chargesMade: 4 });
    set("Charges to cover", "5");
    expect(screen.getByText(/Check the subscriber impact/)).toBeTruthy();
    expect(
      screen.getAllByText(/ends it after 2 more charges, so only 2 of the 5 discounted charges will apply/).length,
    ).toBeGreaterThan(0);

    apply();
    expect(onApply).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Apply this discount anyway?" });
    expect(dialog.textContent).toContain("only 2 of the 5 discounted charges");

    fireEvent.click(screen.getByRole("button", { name: "Confirm: apply discount" }));
    expect(onApply).toHaveBeenCalledWith(1000, 5);
  });

  it("explains that a zero charge fails and can end the mandate, and backs out on request", () => {
    const { onApply, set, apply } = setup({ amount: 9_999n });
    set("Discount (%)", "99.99");
    expect(screen.getAllByText(/rounds the charge down to zero/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/can end when the grace period runs out/).length).toBeGreaterThan(0);

    apply();
    const confirm = screen.getByRole("button", { name: "Confirm: apply discount" });
    // Ending a mandate is irreversible, so the confirm button uses the danger colour.
    expect(confirm.className).toContain("btn-danger");
    fireEvent.click(screen.getByRole("button", { name: "Change the discount" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("announces the warning politely as the inputs change", () => {
    const { set } = setup({ maxCharges: 2, chargesMade: 1 });
    const region = screen.getByText((_, el) => el?.getAttribute("aria-live") === "polite" && el.tagName === "DIV");
    expect(region.textContent).toContain("Check the subscriber impact");
    set("Charges to cover", "1");
    expect(region.textContent).toBe("");
  });

  it("explains the charges field in an info tooltip", () => {
    setup();
    expect(screen.getByRole("button", { name: "About the number of discounted charges" })).toBeTruthy();
  });
});
