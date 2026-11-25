// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SectionShortcuts } from "@/components/SectionShortcuts";
import en from "@/i18n/en.json";
import fr from "@/i18n/fr.json";

const TITLES = ["Revenue over time", "Publish a plan", "My plans", "Subscribers"];

/** jsdom has no layout, so each section's `top` is faked from a scroll offset. */
let scrollY = -300; // the header sits above the first section
const SECTION_HEIGHT = 600;

function Page({ withDialog = false }: { withDialog?: boolean }) {
  return (
    <div>
      <main>
        <SectionShortcuts />
        <input aria-label="Plan name" />
        <button type="button">A button</button>
        {TITLES.map((title) => (
          <section key={title} className="panel" data-title={title}>
            <h2>{title}</h2>
          </section>
        ))}
      </main>
      {withDialog && <div role="dialog" aria-label="Confirm" />}
    </div>
  );
}

function sections(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("main section.panel"));
}

beforeEach(() => {
  scrollY = -300;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    const index = sections().indexOf(this as HTMLElement);
    if (index >= 0) scrollY = index * SECTION_HEIGHT;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const index = sections().indexOf(this);
    const top = index < 0 ? 0 : index * SECTION_HEIGHT - scrollY;
    return { top, bottom: top + SECTION_HEIGHT, left: 0, right: 0, width: 0, height: SECTION_HEIGHT, x: 0, y: top, toJSON() {} };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const press = (key: string, target: Element | Document = document) => fireEvent.keyDown(target, { key });

describe("SectionShortcuts", () => {
  it("shows a visible hint naming both keys", () => {
    render(<Page />);
    const hint = screen.getByTestId("section-shortcuts-hint");
    expect(hint.textContent).toContain("J");
    expect(hint.textContent).toContain("K");
    expect(hint.textContent).toMatch(/jump between sections/);
  });

  it("J moves focus to the next section and announces it", () => {
    render(<Page />);
    press("j");
    expect(document.activeElement).toBe(sections()[0]);
    expect(screen.getByRole("status").textContent).toBe("Section 1 of 4: Revenue over time");

    press("j");
    expect(document.activeElement).toBe(sections()[1]);
    expect(screen.getByRole("status").textContent).toBe("Section 2 of 4: Publish a plan");
  });

  it("K moves back, and stops with an announcement at the first section", () => {
    render(<Page />);
    press("j");
    press("j");
    press("k");
    expect(document.activeElement).toBe(sections()[0]);
    press("k");
    expect(document.activeElement).toBe(sections()[0]);
    expect(screen.getByRole("status").textContent).toBe("First section");
  });

  it("stops at the last section instead of wrapping", () => {
    render(<Page />);
    for (let i = 0; i < 4; i += 1) press("j");
    expect(document.activeElement).toBe(sections()[3]);
    press("j");
    expect(document.activeElement).toBe(sections()[3]);
    expect(screen.getByRole("status").textContent).toBe("Last section");
  });

  it("scrolls the target into view and makes it focusable without joining the tab order", () => {
    render(<Page />);
    press("j");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(sections()[0]?.getAttribute("tabindex")).toBe("-1");
  });

  it("does nothing while typing in a field", () => {
    render(<Page />);
    const input = screen.getByLabelText("Plan name");
    input.focus();
    press("j", input);
    press("k", input);
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does nothing with a modifier held", () => {
    render(<Page />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.keyDown(document, { key: "j", metaKey: true });
    fireEvent.keyDown(document, { key: "j", altKey: true });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does nothing while a dialog is open", () => {
    render(<Page withDialog />);
    press("j");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("ignores a held-down key", () => {
    render(<Page />);
    fireEvent.keyDown(document, { key: "j", repeat: true });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("works from a focused button, which is not text entry", () => {
    render(<Page />);
    const button = screen.getByRole("button", { name: "A button" });
    button.focus();
    press("j", button);
    expect(document.activeElement).toBe(sections()[0]);
  });

  it("does nothing, and does not throw, on a page with no sections", () => {
    render(
      <main>
        <SectionShortcuts />
      </main>,
    );
    expect(() => press("j")).not.toThrow();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("stops listening when unmounted", () => {
    const { unmount } = render(<Page />);
    unmount();
    press("j");
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("reads the position from where the page is scrolled", async () => {
    render(<Page />);
    scrollY = 2 * SECTION_HEIGHT + 50; // the third section has reached the top
    await act(async () => {
      press("j");
    });
    expect(document.activeElement).toBe(sections()[3]);
  });
});

describe("shortcut copy is translated", () => {
  it("has a French entry for every new string", () => {
    for (const key of [
      "Last section",
      "First section",
      "Section {0} of {1}: {2}",
      "Press",
      "or",
      "to jump between sections.",
    ]) {
      expect((en as Record<string, string>)[key], key).toBeTruthy();
      expect((fr as Record<string, string>)[key], key).toBeTruthy();
    }
    expect((fr as Record<string, string>)["Section {0} of {1}: {2}"]).toContain("{2}");
  });
});
