// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AmountInput } from "@/components/AmountInput";
import { I18nProvider, LOCALE_STORAGE_KEY } from "@/i18n/provider";
import { MAX_AMOUNT_STROOPS, parseAmount } from "@/lib/format";

/**
 * The field itself (issues #46, #387): whatever separator style the user's
 * keyboard produces is accepted, a negative, over-precise or overflowing
 * amount is rejected with an explanation, and the raw text a page would submit
 * through `parseAmount` stays faithful.
 */

beforeEach(() => localStorage.clear());
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

/** The same field under the French catalog, to exercise locale separators. */
function FrHarness({ decimals = 7 }: { decimals?: number }) {
  const [value, setValue] = useState("");
  return (
    <I18nProvider>
      <AmountInput
        id="fr-amount"
        label="Amount (XLM)"
        value={value}
        onChange={setValue}
        decimals={decimals}
      />
      <output>{value}</output>
    </I18nProvider>
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

  it("rejects a negative amount instead of silently flipping its sign", () => {
    // "-5" used to be filtered down to "5", turning a refund into a charge.
    render(<Harness />);
    type("-1.5");
    const input = screen.getByLabelText("Amount (XLM)") as HTMLInputElement;
    expect(input.value).toBe("-1.5");
    expect(screen.getByText(/positive number/i)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // The value never reaches the parser as the positive 1.5.
    expect(screen.getByRole("status").textContent).toBe("invalid");
  });

  it("rejects an amount above the contract's i128 maximum", () => {
    render(<Harness decimals={0} />);
    const input = screen.getByLabelText("Amount (XLM)") as HTMLInputElement;

    type(MAX_AMOUNT_STROOPS.toString());
    expect(screen.queryByText(/too large/i)).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();

    // One stroop over is unrepresentable on-chain, so the field refuses it
    // while keeping every digit the user typed.
    const overflow = (MAX_AMOUNT_STROOPS + 1n).toString();
    type(overflow);
    expect(input.value).toBe(overflow);
    expect(screen.getByText(/too large/i)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("accepts exactly the token's decimals and reports one place more", () => {
    render(<Harness decimals={2} />);
    const input = screen.getByLabelText("Amount (XLM)") as HTMLInputElement;

    type("1.23");
    expect(screen.queryByText(/decimal places/i)).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();

    type("1.234");
    expect(screen.getByText(/at most 2 decimal places/i)).toBeTruthy();
    expect(input.value).toBe("1.234");
  });

  it("rejects any fraction for a whole-number token", () => {
    render(<Harness decimals={0} />);
    type("5.5");
    expect(screen.getByText(/at most 0 decimal places/i)).toBeTruthy();
    expect(
      (screen.getByLabelText("Amount (XLM)") as HTMLInputElement).value,
    ).toBe("5.5");
  });

  it("accepts French grouping and decimal marks and explains invalid input", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    render(<FrHarness decimals={2} />);
    const input = (await screen.findByLabelText(
      "Montant (XLM)",
    )) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "1 234,5" } });
    expect(input.value).toBe("1234,5");
    expect(input.getAttribute("aria-invalid")).toBeNull();

    fireEvent.change(input, { target: { value: "1.234,567" } });
    expect(screen.getByText(/au maximum 2 décimales/i)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(input, { target: { value: "1,2,3" } });
    expect(screen.getByText(/saisissez un nombre positif/i)).toBeTruthy();
  });
});
