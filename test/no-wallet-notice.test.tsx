// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoWalletNotice } from "@/components/NoWalletNotice";
import { I18nProvider } from "@/i18n/provider";
import en from "@/i18n/en.json";
import fr from "@/i18n/fr.json";

afterEach(cleanup);

describe("NoWalletNotice", () => {
  it("explains what is missing and links to wallets that open safely in a new tab", () => {
    render(<NoWalletNotice />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("No Stellar wallet found.");
    expect(status.textContent).toMatch(/reload this page/i);

    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.textContent).toMatch(/opens in a new tab/);
    }
    expect(links[0]?.getAttribute("href")).toContain("freighter.app");
  });

  it("has no dismiss control unless asked for, and calls back when used", () => {
    const { rerender } = render(<NoWalletNotice />);
    expect(screen.queryByRole("button")).toBeNull();

    const onDismiss = vi.fn();
    rerender(<NoWalletNotice onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss wallet notice" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("uses the theme's warning tokens rather than fixed colours", () => {
    render(<NoWalletNotice />);
    const cls = screen.getByRole("status").className;
    expect(cls).toMatch(/border-warn/);
    expect(cls).toMatch(/text-warn/);
    expect(cls).not.toMatch(/#[0-9a-f]{3,6}|bg-white|text-black/i);
  });

  it("renders inside the i18n provider", () => {
    render(
      <I18nProvider>
        <NoWalletNotice />
      </I18nProvider>,
    );
    expect(screen.getByText("No Stellar wallet found.")).toBeTruthy();
  });
});

describe("no-wallet copy is translated", () => {
  const keys = [
    "No Stellar wallet found.",
    "Payflow needs a wallet to sign payments. Install one, then reload this page.",
    "Get {0}",
    "(opens in a new tab)",
    "Dismiss wallet notice",
    "Dismiss",
  ];
  it("has a French entry for every English key", () => {
    for (const key of keys) {
      expect((en as Record<string, string>)[key], key).toBeTruthy();
      expect((fr as Record<string, string>)[key], key).toBeTruthy();
    }
  });
});
