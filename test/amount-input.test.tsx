// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AmountInput } from "@/components/AmountInput";
import { parseAmount } from "@/lib/format";

/**
 * The field itself (issue #46): whatever separator style the user's keyboard
 * produces is accepted, the fraction never exceeds the token's decimals, and
 * the raw text a page would submit through `parseAmount` stays faithful.
 */

afterEach(cleanup);

/** Never let a mid-edit value crash the harness: the field shows errors. */
function tryParse(value: string, decimals: number): string {
  try {
    return String(parseAmount(value, decimals));
  } catch {
    return "invalid";
  }
}

/** A stateful wrapper so fireEvent drives the real controlled loop. */
function Harness({ decimals = 7 }: { decimals?: number }) {
  const [value, setValue] = useState("");
  return (
    <div>
      <AmountInput
        id="amount"
        label="Amount (XLM)"
        value={value}
        onChange={setValue}
        decimals={decimals}
        placeholder="5.0"
      />
      <output>{value ? tryParse(value, decimals) : ""}</output>
    </div>
  );
}

function type(text: string) {
  fireEvent.change(screen.getByLabelText("Amount (XLM)"), {
    target: { value: text },
  });
}

describe("AmountInput", () => {
  it("labels the field for keyboards and screen readers", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Amount (XLM)")).toBeTruthy();
    expect(
      (screen.getByLabelText("Amount (XLM)") as HTMLInputElement).inputMode,
    ).toBe("decimal");
  });

  it("accepts dot-decimal and comma-decimal input to the same bigint", () => {
    // The acceptance criterion of #46: "1.234,5" and "1,234.5" are the same
    // amount, and both survive as bigint stroops.
    render(<Harness />);
    type("1,234.5");
    expect(screen.getByRole("status").textContent).toBe("12345000000");
    cleanup();
    render(<Harness />);
    type("1.234,5");
    expect(screen.getByRole("status").textContent).toBe("12345000000");
  });

  it("keeps over-precision visible so the error can explain it", () => {
    // Silent truncation would change the amount the user typed. Four decimal
    // places can only be a fraction, so the value is unambiguous.
    render(<Harness decimals={2} />);
    type("1,234.5678");
    const input = screen.getByLabelText("Amount (XLM)") as HTMLInputElement;
    expect(input.value).toBe("1,234.5678");
    expect(screen.getByText(/at most 2 decimal places/i)).toBeTruthy();
  });

  it("shows an error the moment the value cannot become money", () => {
    render(<Harness />);
    expect(screen.queryByText(/positive number/i)).toBeNull();
    type("1.2.3");
    const input = screen.getByLabelText("Amount (XLM)") as HTMLInputElement;
    expect(screen.getByText(/positive number/i)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("amount-error");
  });

  it("does not flash an error for a half-typed separator", () => {
    render(<Harness />);
    type("12.");
    expect(screen.queryByText(/positive number/i)).toBeNull();
    expect(
      (screen.getByLabelText("Amount (XLM)") as HTMLInputElement).value,
    ).toBe("12.");
  });
});
