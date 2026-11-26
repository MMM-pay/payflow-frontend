// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, LOCALE_STORAGE_KEY } from "@/i18n/provider";
import { LanguagePicker } from "@/i18n/LanguagePicker";
import { Search } from "@/components/Search";

function App() {
  return <I18nProvider><LanguagePicker /><Search value="" onChange={() => {}} /></I18nProvider>;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});
afterEach(cleanup);

describe("RTL layout support (#334)", () => {
  it("offers Arabic and mirrors the document when it is restored from storage", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "ar");
    render(<App />);
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(document.documentElement.lang).toBe("ar");
    const arabic = screen.getByRole("option", { name: "العربية" }) as HTMLOptionElement;
    expect(arabic.value).toBe("ar");
    expect(arabic.dir).toBe("rtl");
  });

  it("flips direction back when the reader chooses a LTR language", async () => {
    render(<App />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ar" } });
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
    await waitFor(() => expect(document.documentElement.dir).toBe("ltr"));
    expect(document.documentElement.lang).toBe("en");
  });

  it("uses logical spacing classes so existing LTR positions mirror in RTL", () => {
    render(<App />);
    const input = screen.getByRole("searchbox");
    expect(input.className).toContain("ps-9");
    expect(input.className).toContain("pe-9");
    expect(screen.getByRole("search").querySelector("svg")?.className.baseVal).toContain("start-3");
  });
});
