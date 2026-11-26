// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MerchantAccount } from "@/components/ui";
import { I18nProvider } from "@/i18n/provider";

afterEach(cleanup);

describe("MerchantAccount", () => {
  it("renders a supplied display name without resolving external metadata", () => {
    render(
      <I18nProvider>
        <MerchantAccount
          value="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
          resolvedName="Acme Payments"
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Acme Payments")).toBeTruthy();
    expect(screen.getByText("(self-declared merchant name)")).toBeTruthy();
  });
});
