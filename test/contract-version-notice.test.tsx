// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContractVersionNotice } from "@/components/ContractVersionNotice";
import {
  NO_DRIFT,
  observeContractRecord,
  resetContractDrift,
} from "@/lib/contract-compat";

/**
 * The contract-version notice (issue #412): it stays out of the way for a
 * contract this build understands, appears when a newer one was observed, and
 * can be driven directly by the data a page already holds.
 */

beforeEach(resetContractDrift);
afterEach(cleanup);

describe("ContractVersionNotice", () => {
  it("renders nothing when the contract shape is known", () => {
    const { container } = render(<ContractVersionNotice />);
    expect(container.firstChild).toBeNull();
    render(<ContractVersionNotice drift={NO_DRIFT} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("explains the drift without treating it as an error", () => {
    render(
      <ContractVersionNotice
        drift={{ newer: true, unknownFields: ["referral_bps"], unknownStatus: null }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/newer than this version/i);
    expect(status.textContent).toMatch(/still works/i);
  });

  it("appears when a read observes a newer contract", () => {
    render(<ContractVersionNotice />);
    expect(screen.queryByRole("status")).toBeNull();

    act(() => {
      observeContractRecord("mandate", {
        id: 1n,
        status: ["Suspended"],
      });
    });
    expect(screen.getByRole("status").textContent).toMatch(/newer than this version/i);
  });
});
