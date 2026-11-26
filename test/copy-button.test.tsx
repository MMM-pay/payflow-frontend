// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopyButton } from "@/components/CopyButton";
import { I18nProvider } from "@/i18n/provider";

const VALUE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
let clipboardDescriptor: PropertyDescriptor | undefined;

afterEach(() => {
  cleanup();
  const descriptor = clipboardDescriptor;
  clipboardDescriptor = undefined;
  if (descriptor) {
    Object.defineProperty(navigator, "clipboard", descriptor);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
});

describe("CopyButton", () => {
  it("copies the full value and announces success", async () => {
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <I18nProvider>
        <CopyButton value={VALUE} label="example address" />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy example address" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(VALUE);
      expect(screen.getByRole("status").textContent).toBe(
        "example address copied to clipboard",
      );
    });
  });
});
