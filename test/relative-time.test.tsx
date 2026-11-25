// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TimeAgo } from "@/components/ui";
import { formatWhen } from "@/i18n/format";
import { I18nProvider, LOCALE_STORAGE_KEY } from "@/i18n/provider";

// A pinned clock keeps the words stable whenever CI runs.
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const DAY = 86_400_000;
const at = (deltaMs: number) => Math.floor((NOW + deltaMs) / 1000);

describe("formatWhen: English", () => {
  it("counts days up to a fortnight, then weeks, months and years", () => {
    expect(formatWhen(at(3 * DAY), "en", NOW)).toBe("in 3 days");
    expect(formatWhen(at(14 * DAY), "en", NOW)).toBe("in 14 days");
    expect(formatWhen(at(15 * DAY), "en", NOW)).toBe("in 2 weeks");
    expect(formatWhen(at(21 * DAY), "en", NOW)).toBe("in 3 weeks");
    expect(formatWhen(at(30 * DAY), "en", NOW)).toBe("in 1 month");
    expect(formatWhen(at(90 * DAY), "en", NOW)).toBe("in 3 months");
    expect(formatWhen(at(365 * DAY), "en", NOW)).toBe("in 1 year");
    expect(formatWhen(at(800 * DAY), "en", NOW)).toBe("in 2 years");
  });

  it("uses the same scale for the past", () => {
    expect(formatWhen(at(-3 * DAY), "en", NOW)).toBe("3 days ago");
    expect(formatWhen(at(-21 * DAY), "en", NOW)).toBe("3 weeks ago");
    expect(formatWhen(at(-120 * DAY), "en", NOW)).toBe("4 months ago");
  });

  it("describes a charge due this minute, and a missing one", () => {
    expect(formatWhen(at(0), "en", NOW)).toBe("due now");
    expect(formatWhen(at(-20_000), "en", NOW)).toBe("just now");
    expect(formatWhen(0, "en", NOW)).toBe("—");
  });
});

describe("formatWhen: French", () => {
  it("uses French grammar, not translated English", () => {
    expect(formatWhen(at(3 * DAY), "fr", NOW)).toBe("dans 3 jours");
    expect(formatWhen(at(DAY), "fr", NOW)).toBe("dans 1 jour");
    expect(formatWhen(at(-3 * DAY), "fr", NOW)).toBe("il y a 3 jours");
    expect(formatWhen(at(21 * DAY), "fr", NOW)).toBe("dans 3 semaines");
    expect(formatWhen(at(90 * DAY), "fr", NOW)).toBe("dans 3 mois");
    expect(formatWhen(at(800 * DAY), "fr", NOW)).toBe("dans 2 ans");
    expect(formatWhen(at(3 * 3_600_000), "fr", NOW)).toBe("dans 3 heures");
  });

  it("has its own wording for due and just-passed", () => {
    expect(formatWhen(at(0), "fr", NOW)).toBe("échéance immédiate");
    expect(formatWhen(at(-20_000), "fr", NOW)).toBe("à l’instant");
    expect(formatWhen(0, "fr", NOW)).toBe("—");
  });
});

describe("unit boundaries", () => {
  it("never skips a unit or reads zero", () => {
    for (let days = 1; days <= 800; days += 1) {
      const text = formatWhen(at(days * DAY), "en", NOW);
      expect(text, `${days} days`).toMatch(/^in [1-9]\d* (day|week|month|year)s?$/);
    }
  });

  it("is non-decreasing as the date moves out", () => {
    const rank = { day: 0, week: 1, month: 2, year: 3 } as const;
    let last = 0;
    for (let days = 1; days <= 800; days += 1) {
      const unit = /(day|week|month|year)/.exec(formatWhen(at(days * DAY), "en", NOW))?.[1] as
        | keyof typeof rank
        | undefined;
      expect(unit).toBeDefined();
      expect(rank[unit!]).toBeGreaterThanOrEqual(last);
      last = rank[unit!];
    }
  });
});

describe("TimeAgo follows the visitor's saved locale", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  const future = Math.floor(Date.now() / 1000) + 3 * 86_400 + 600;

  it("renders English by default, with the exact time for screen readers", () => {
    render(
      <I18nProvider>
        <TimeAgo value={future} />
      </I18nProvider>,
    );
    const el = screen.getByText(/in 3 days/);
    expect(el.tagName).toBe("TIME");
    expect(el.getAttribute("datetime")).toBe(new Date(future * 1000).toISOString());
    expect(el.textContent).toMatch(/UTC\)/);
  });

  it("switches to French when that is the saved locale", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    render(
      <I18nProvider>
        <TimeAgo value={future} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText(/dans 3 jours/)).toBeTruthy());
  });

  it("shows a dash for a missing timestamp", () => {
    render(
      <I18nProvider>
        <TimeAgo value={0} />
      </I18nProvider>,
    );
    expect(screen.getByText("—")).toBeTruthy();
  });
});
