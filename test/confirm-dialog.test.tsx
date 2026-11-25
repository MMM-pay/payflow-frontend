// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog, confirmTitle } from "@/components/ConfirmDialog";

/**
 * Standard confirmation copy and button order (issue #407): the safe choice
 * comes first, the committing action last, and the committing button reports
 * progress without accepting a second press.
 */

afterEach(cleanup);

function setup(overrides: { busy?: boolean; danger?: boolean; error?: ReactNode } = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const utils = render(
    <ConfirmDialog
      open
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="Cancel 2 subscriptions?"
      confirmLabel="Confirm cancellation"
      {...overrides}
    >
      <p>Both stop billing immediately.</p>
    </ConfirmDialog>,
  );
  return { onCancel, onConfirm, ...utils };
}

describe("ConfirmDialog", () => {
  it("asks the question in the title", () => {
    setup();
    expect(
      screen.getByRole("dialog", { name: "Cancel 2 subscriptions?" }),
    ).toBeTruthy();
  });

  it("puts the safe choice first and the committing action last", () => {
    setup();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm cancellation" });
    // Document order is what a keyboard user tabs through.
    expect(
      cancel.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(confirm.className).toContain("btn-primary");
  });

  it("uses the danger colour for an irreversible action", () => {
    setup({ danger: true });
    expect(
      screen.getByRole("button", { name: "Confirm cancellation" }).className,
    ).toContain("btn-danger");
  });

  it("cancels without confirming", () => {
    const { onCancel, onConfirm } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows progress and refuses repeat confirmation while busy", () => {
    const { onConfirm } = setup({ busy: true });
    const button = screen.getByRole("button", { name: /Confirm cancellation/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("normalises a title into a question without doubling the mark", () => {
    expect(confirmTitle("Deactivate all plans")).toBe("Deactivate all plans?");
    expect(confirmTitle("Deactivate all plans?")).toBe("Deactivate all plans?");
    expect(confirmTitle("  ")).toBe("");
  });

  it("announces a failure as an alert, so it can be retried without losing context", () => {
    setup({ error: "The transaction was rejected." });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The transaction was rejected.");
    // Both buttons stay usable: the failure is recoverable, not terminal.
    expect(
      (screen.getByRole("button", { name: "Confirm cancellation" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("shows nothing where the error would go when there isn't one", () => {
    setup();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores Escape and the close button while busy, then honours them again once it ends", () => {
    const { onCancel, rerender } = setup({ busy: true });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onCancel).not.toHaveBeenCalled();

    rerender(
      <ConfirmDialog
        open
        onCancel={onCancel}
        onConfirm={vi.fn()}
        title="Cancel 2 subscriptions?"
        confirmLabel="Confirm cancellation"
        busy={false}
      >
        <p>Both stop billing immediately.</p>
      </ConfirmDialog>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("traps Tab inside the dialog and restores focus to the opener on Escape", () => {
    const opener = document.createElement("button");
    opener.textContent = "Open confirm";
    document.body.appendChild(opener);
    opener.focus();

    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open
        onCancel={onCancel}
        onConfirm={vi.fn()}
        title="Cancel 2 subscriptions?"
        confirmLabel="Confirm cancellation"
      >
        <p>Both stop billing immediately.</p>
      </ConfirmDialog>,
    );

    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);

    const close = screen.getByRole("button", { name: "Close dialog" });
    const confirm = screen.getByRole("button", { name: "Confirm cancellation" });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <ConfirmDialog
        open={false}
        onCancel={onCancel}
        onConfirm={vi.fn()}
        title="Cancel 2 subscriptions?"
        confirmLabel="Confirm cancellation"
      >
        <p>Both stop billing immediately.</p>
      </ConfirmDialog>,
    );
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
