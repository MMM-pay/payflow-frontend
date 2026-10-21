// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "@/components/ui";

/**
 * Focus behaviour for `Dialog` (issue #83), which is the acceptance criterion:
 * focus moves in when the dialog opens, cannot get out while it is open,
 * Escape and the close button both dismiss it, and focus goes back to whoever
 * opened it.
 *
 * The dialog is always driven from a harness rather than mounted with
 * `open={true}`, because the component reads `document.activeElement` as it
 * opens to learn where to return focus — that has to be a real transition from
 * an opener, as it is in the app. `fireEvent.click` does not focus the button
 * it clicks the way a browser does, so the opener is focused explicitly first.
 */

function Harness({
  onClosed,
  actions = true,
  withField = true,
  confirmDisabled = false,
  hideOpener = false,
}: {
  onClosed?: () => void;
  actions?: boolean;
  withField?: boolean;
  confirmDisabled?: boolean;
  hideOpener?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <>
      {hideOpener ? null : (
        <button type="button" onClick={() => setOpen(true)}>
          Cancel these plans
        </button>
      )}
      <button type="button">A control behind the dialog</button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClosed?.();
        }}
        title="Cancel 2 subscriptions?"
        actions={
          actions ? (
            <>
              <button type="button" className="btn-ghost">
                Keep them
              </button>
              <button type="button" className="btn-danger" disabled={confirmDisabled}>
                Confirm cancellation
              </button>
            </>
          ) : undefined
        }
      >
        <p>Both mandates stop billing immediately.</p>
        {withField && (
          <>
            <label className="label" htmlFor="cancel-reason">
              Reason
            </label>
            <input
              id="cancel-reason"
              className="input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </>
        )}
      </Dialog>
    </>
  );
}

const CLOSE = "Close dialog";
const KEEP = "Keep them";
const CONFIRM = "Confirm cancellation";
const OPENER = "Cancel these plans";
const OUTSIDE = "A control behind the dialog";

/** Open the dialog the way a user does: focus the opener, then click it. */
function opened(options: Parameters<typeof Harness>[0] = {}) {
  render(<Harness {...options} />);
  const opener = screen.getByRole("button", { name: OPENER });
  opener.focus();
  fireEvent.click(opener);
  return {
    opener,
    dialog: screen.getByRole("dialog"),
    close: screen.getByRole("button", { name: CLOSE }),
    outside: screen.getByRole("button", { name: OUTSIDE }),
  };
}

function pressTab(on: Element, shift = false) {
  fireEvent.keyDown(on, { key: "Tab", shiftKey: shift });
}

function control(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name });
}

afterEach(cleanup);

describe("Dialog rendering", () => {
  it("renders nothing until it is opened", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal named by its title", () => {
    const { dialog } = opened();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const heading = screen.getByRole("heading", { level: 2, name: "Cancel 2 subscriptions?" });
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("holds its content and its actions", () => {
    opened();
    expect(screen.getByText("Both mandates stop billing immediately.")).toBeTruthy();
    expect(control(KEEP)).toBeTruthy();
  });
});

describe("Dialog focus on open and close", () => {
  it("puts focus on the dialog itself, not on one of its controls", () => {
    const { dialog, opener } = opened();
    // Focusing the panel rather than the first control means the title is read
    // out before any button, and a dialog with nothing to press still holds
    // the focus.
    expect(document.activeElement).toBe(dialog);
    expect(document.activeElement).not.toBe(opener);
  });

  it("returns focus to the opener when Escape dismisses it", () => {
    const { opener } = opened();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to the opener when the close button dismisses it", () => {
    const { opener, close } = opened();
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to the opener from whichever control held it", () => {
    const { opener } = opened();
    const confirm = control(CONFIRM);
    confirm.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  it("does not chase focus once the dialog is closed", () => {
    const { close, outside } = opened();
    fireEvent.click(close);
    // A dismissed dialog no longer owns the page.
    outside.focus();
    expect(document.activeElement).toBe(outside);
  });

  it("survives an opener that left the document while the dialog was open", () => {
    const view = render(<Harness />);
    const opener = screen.getByRole("button", { name: OPENER });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeTruthy();

    // The parent re-renders the row away while the confirmation is up, so the
    // control that opened the dialog is gone by the time it is dismissed.
    view.rerender(<Harness hideOpener />);
    expect(() => fireEvent.keyDown(document, { key: "Escape" })).not.toThrow();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("Dialog focus trap", () => {
  it("Tab from the dialog moves to its first control", () => {
    const { dialog, close } = opened();
    pressTab(dialog);
    expect(document.activeElement).toBe(close);
  });

  it("Tab from the last control wraps to the first", () => {
    const { close } = opened();
    const confirm = control(CONFIRM);
    confirm.focus();
    pressTab(confirm);
    expect(document.activeElement).toBe(close);
  });

  it("Shift+Tab from the first control wraps to the last", () => {
    const { close } = opened();
    // The handler reads where focus actually is, so put it there first.
    close.focus();
    pressTab(close, true);
    expect(document.activeElement).toBe(control(CONFIRM));
  });

  it("Shift+Tab from the dialog wraps to the last control", () => {
    const { dialog } = opened();
    pressTab(dialog, true);
    expect(document.activeElement).toBe(control(CONFIRM));
  });

  it("steps through the controls in document order", () => {
    const { dialog } = opened();
    const close = control(CLOSE);
    const field = screen.getByRole("textbox", { name: "Reason" });
    pressTab(dialog);
    expect(document.activeElement).toBe(close);
    pressTab(close);
    expect(document.activeElement).toBe(field);
    pressTab(field);
    expect(document.activeElement).toBe(control(KEEP));
    pressTab(control(KEEP));
    expect(document.activeElement).toBe(control(CONFIRM));
  });

  it("skips a disabled control", () => {
    const { close } = opened({ confirmDisabled: true });
    expect(control(CONFIRM).disabled).toBe(true);
    const keep = control(KEEP);
    keep.focus();
    pressTab(keep);
    expect(document.activeElement).toBe(close);
    pressTab(close, true);
    expect(document.activeElement).toBe(keep);
  });

  it("reclaims focus that left the dialog without a Tab", () => {
    const { dialog, outside } = opened();
    // The escapes Tab arithmetic does not cover: a click on a background
    // control, or a control taking focus on its own.
    outside.focus();
    expect(document.activeElement).toBe(dialog);
  });

  it("holds focus in a field while the parent re-renders on every keystroke", () => {
    opened();
    const field = screen.getByRole("textbox", { name: "Reason" });
    field.focus();
    fireEvent.change(field, { target: { value: "moving abroad" } });
    expect(document.activeElement).toBe(field);
    expect((field as HTMLInputElement).value).toBe("moving abroad");
  });

  it("traps focus when the only control is the close button", () => {
    const { dialog, close, outside } = opened({ actions: false, withField: false });
    expect(screen.queryByRole("button", { name: KEEP })).toBeNull();
    pressTab(dialog);
    expect(document.activeElement).toBe(close);
    // One control in the ring: Tab and Shift+Tab both stay on it.
    pressTab(close);
    expect(document.activeElement).toBe(close);
    pressTab(close, true);
    expect(document.activeElement).toBe(close);
    outside.focus();
    expect(document.activeElement).toBe(dialog);
  });
});

describe("Dialog dismissal", () => {
  it("calls onClose once per Escape", () => {
    const onClosed = vi.fn();
    opened({ onClosed });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close button is pressed", () => {
    const onClosed = vi.fn();
    const { close } = opened({ onClosed });
    fireEvent.click(close);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("leaves other keys to the dialog's own content", () => {
    const onClosed = vi.fn();
    opened({ onClosed });
    const field = screen.getByRole("textbox", { name: "Reason" });
    field.focus();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("Dialog reuse", () => {
  it("traps focus and returns it again after being reopened", () => {
    const { opener, close } = opened();
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();

    opener.focus();
    fireEvent.click(opener);
    const reopened = screen.getByRole("dialog");
    expect(document.activeElement).toBe(reopened);
    pressTab(reopened);
    expect(document.activeElement).toBe(control(CLOSE));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });
});
