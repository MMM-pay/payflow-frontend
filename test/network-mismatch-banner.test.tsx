// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NetworkMismatchBanner } from "@/components/ui";

afterEach(cleanup);

describe("NetworkMismatchBanner", () => {
  it("explains that an unknown wallet network cannot be verified", () => {
    render(
      <NetworkMismatchBanner
        walletNetwork={null}
        expectedNetwork="Test SDF Network ; September 2015"
        expectedNetworkLabel="Testnet"
        status="unknown"
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("could not be verified");
    expect(screen.getByRole("alert").textContent).toContain("Testnet");
    expect(screen.getByRole("alert").textContent).toContain("Test SDF Network ; September 2015");
    expect(screen.getByRole("alert").textContent).toContain("Signing is disabled");
    expect(screen.getByRole("alert").textContent).not.toContain("Network mismatch detected");
  });

  it("shows both network identifiers for a mismatch with theme-aware warning styles", () => {
    render(
      <NetworkMismatchBanner
        walletNetwork="Public Global Stellar Network ; September 2015"
        expectedNetwork="Test SDF Network ; September 2015"
        expectedNetworkLabel="Testnet"
        status="mismatch"
      />,
    );

    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("Public Global Stellar Network ; September 2015");
    expect(banner.textContent).toContain("Test SDF Network ; September 2015");
    expect(banner.className).toContain("border-warn/40");
    expect(banner.className).toContain("bg-warn/10");
    expect(banner.className).toContain("text-warn");
  });
});
