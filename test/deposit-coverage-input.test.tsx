// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DepositCoverageInput } from "@/components/DepositCoverageInput";

/**
 * The deposit form (issue #408): the period and amount fields stay in sync in
 * both directions, the deposit cannot be submitted while the input is
 * invalid, and the button reports an in-flight deposit.
 */

const PRICE = 5_000_000n; // 0.5 XLM per period

afterEach(cleanup);

function setup(overrides: { busy?: boolean; disabled?: boolean } = {}) {
  const onDeposit = vi.fn();
  render(
    <DepositCoverageInput
      planAmount={PRICE}
      decimals={7}
      symbol="XLM"
      onDeposit={onDeposit}
      {...overrides}
    />,
  );
  return { onDeposit };
}

describe("DepositCoverageInput", () => {
  it("starts at the suggested three periods and the matching amount", () => {
    setup();
    expect((screen.getByLabelText("Periods") as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("Amount (XLM)") as HTMLInputElement).value).toBe("1.5");
    expect(screen.getByText("1.5 XLM covers 3 periods.")).toBeTruthy();
  });

  it("rewrites the amount when the periods change", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Periods"), { target: { value: "5" } });
    expect((screen.getByLabelText("Amount (XLM)") as HTMLInputElement).value).toBe("2.5");
    expect(screen.getByText("2.5 XLM covers 5 periods.")).toBeTruthy();
  });

  it("derives whole periods when the amount changes", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Amount (XLM)"), { target: { value: "2" } });
    expect((screen.getByLabelText("Periods") as HTMLInputElement).value).toBe("4");
    expect(screen.getByText("2 XLM covers 4 periods.")).toBeTruthy();
  });

  it("deposits the amount shown in the field", () => {
    const { onDeposit } = setup();
    fireEvent.change(screen.getByLabelText("Periods"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    expect(onDeposit).toHaveBeenCalledWith(10_000_000n);
  });

  it("keeps the deposit disabled and explains an invalid periods draft", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Periods"), { target: { value: "2.5" } });
    expect(screen.getByRole("alert").textContent).toContain("whole number of periods");
    expect((screen.getByRole("button", { name: "Deposit" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows progress and blocks a second deposit while busy", () => {
    setup({ busy: true });
    const button = screen.getByRole("button", { name: /Depositing…/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("handles a plan with no price without offering a write", () => {
    render(<DepositCoverageInput planAmount={0n} decimals={7} symbol="XLM" onDeposit={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("no price");
    expect((screen.getByRole("button", { name: "Deposit" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
