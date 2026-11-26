// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Notice } from "@/components/ui";

afterEach(cleanup);

describe("Notice live regions and accessibility", () => {
  it("renders status tone with role=status and aria-live=polite", () => {
    render(<Notice tone="ok">Saved successfully</Notice>);
    const notice = screen.getByRole("status");
    expect(notice).toBeTruthy();
    expect(notice.getAttribute("aria-live")).toBe("polite");
    expect(notice.textContent).toContain("Saved successfully");
  });

  it("renders info tone with role=status and aria-live=polite", () => {
    render(<Notice tone="info">Information updated</Notice>);
    const notice = screen.getByRole("status");
    expect(notice).toBeTruthy();
    expect(notice.getAttribute("aria-live")).toBe("polite");
  });

  it("renders warn tone with role=status and aria-live=polite", () => {
    render(<Notice tone="warn">Warning alert</Notice>);
    const notice = screen.getByRole("status");
    expect(notice).toBeTruthy();
    expect(notice.getAttribute("aria-live")).toBe("polite");
  });

  it("renders error tone with role=alert and aria-live=polite", () => {
    render(<Notice tone="error">Failed to save</Notice>);
    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.getAttribute("aria-live")).toBe("polite");
    expect(alert.textContent).toContain("Failed to save");
  });
});
