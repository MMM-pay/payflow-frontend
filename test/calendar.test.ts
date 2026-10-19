import { describe, expect, it } from "vitest";
import type { ApiMandate } from "@/lib/api";
import {
  buildUpcomingChargesCalendar,
  escapeIcsText,
  foldIcsLine,
  recurrenceRule,
  toIcsDate,
} from "@/lib/calendar";

/**
 * A calendar that imports but puts the reminder at the wrong time is worse than
 * no reminder at all, so the date formatting, recurrence bounds, escaping and
 * 75-octet folding are all pinned down here.
 */

const MERCHANT = "GCH5VHWNS24VI75HLDBHK4SSJ2E5XZA5IB6XEZTNE4BJH7AKZI6Z3MHU";
const SUBSCRIBER = "GAP6QFLXQD73URCC3EXU2WOQHIAREPCGMSIMKF5PFLLI5TR6HTMNDTIE";
const MONTH = 2_592_000;
const NEXT = 1_793_000_000;
const NOW = 1_792_000_000;

function mandate(over: Partial<ApiMandate> = {}): ApiMandate {
  return {
    id: 1,
    subscriber: SUBSCRIBER,
    merchant: MERCHANT,
    plan_id: 1,
    amount: "25000000", // 2.5 XLM
    period: MONTH,
    next_charge: NEXT,
    last_charge: 0,
    charges_made: 0,
    max_charges: 0,
    fee_bps: 100,
    status: "Active",
    ...over,
  };
}

/** Undo RFC 5545 line folding so tests can inspect logical content lines. */
function unfold(calendar: string): string {
  return calendar.replace(/\r\n /g, "");
}

describe("toIcsDate", () => {
  it("formats Unix seconds as a UTC iCalendar timestamp", () => {
    expect(toIcsDate(0)).toBe("19700101T000000Z");
    expect(toIcsDate(Date.UTC(2026, 9, 19, 12, 34, 56) / 1000)).toBe("20261019T123456Z");
  });
});

describe("escapeIcsText", () => {
  it("escapes backslashes, separators and newlines", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });
});

describe("foldIcsLine", () => {
  it("leaves short lines alone", () => {
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds long lines at 75 octets so they can be unfolded losslessly", () => {
    const line = `DESCRIPTION:${"é".repeat(80)}`;
    const folded = foldIcsLine(line);
    expect(folded).toContain("\r\n ");
    for (const physical of folded.split("\r\n")) {
      expect(new TextEncoder().encode(physical).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });
});

describe("recurrenceRule", () => {
  it("maps exact contract periods onto calendar frequencies", () => {
    expect(recurrenceRule({ period: 604_800, charges_made: 0, max_charges: 4 })).toBe(
      "FREQ=WEEKLY;INTERVAL=1;COUNT=4",
    );
    // A 30-day month stays 30 days rather than drifting to a calendar month.
    expect(recurrenceRule({ period: MONTH, charges_made: 0, max_charges: 6 })).toBe(
      "FREQ=DAILY;INTERVAL=30;COUNT=6",
    );
    expect(recurrenceRule({ period: 60, charges_made: 0, max_charges: 3 })).toBe(
      "FREQ=MINUTELY;INTERVAL=1;COUNT=3",
    );
    expect(recurrenceRule({ period: 90, charges_made: 0, max_charges: 2 })).toBe(
      "FREQ=SECONDLY;INTERVAL=90;COUNT=2",
    );
  });

  it("only counts charges the cap still allows", () => {
    // 2 taken of 5 leaves 3 charges, including the one at next_charge.
    expect(recurrenceRule({ period: MONTH, charges_made: 2, max_charges: 5 })).toBe(
      "FREQ=DAILY;INTERVAL=30;COUNT=3",
    );
  });

  it("omits recurrence for open-ended mandates and the final charge", () => {
    expect(recurrenceRule({ period: MONTH, charges_made: 0, max_charges: 0 })).toBeNull();
    expect(recurrenceRule({ period: MONTH, charges_made: 4, max_charges: 5 })).toBeNull();
    expect(recurrenceRule({ period: 0, charges_made: 0, max_charges: 5 })).toBeNull();
  });
});

describe("buildUpcomingChargesCalendar", () => {
  it("wraps events in a valid VCALENDAR with CRLF line endings", () => {
    const calendar = buildUpcomingChargesCalendar([mandate()], { now: NOW });
    expect(calendar.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(calendar).toContain("VERSION:2.0");
    expect(calendar.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(calendar).not.toMatch(/[^\r]\n/);
  });

  it("creates one event per active mandate and skips the rest", () => {
    const calendar = buildUpcomingChargesCalendar(
      [
        mandate({ id: 1, status: "Active" }),
        mandate({ id: 2, status: "Paused" }),
        mandate({ id: 3, status: "Cancelled" }),
        mandate({ id: 4, status: "Completed" }),
        mandate({ id: 5, status: "Active", next_charge: 0 }),
      ],
      { now: NOW },
    );
    expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(calendar).toContain("UID:payflow-mandate-1@payflow.local");
  });

  it("skips an active mandate that has used its whole charge cap", () => {
    const calendar = buildUpcomingChargesCalendar(
      [mandate({ max_charges: 3, charges_made: 3 })],
      { now: NOW },
    );
    expect(calendar).not.toContain("BEGIN:VEVENT");
  });

  it("puts the event at the next charge and includes the amount", () => {
    const calendar = buildUpcomingChargesCalendar([mandate()], { now: NOW });
    expect(calendar).toContain(`DTSTART:${toIcsDate(NEXT)}`);
    expect(calendar).toContain(`DTEND:${toIcsDate(NEXT + 15 * 60)}`);
    expect(calendar).toContain("SUMMARY:Payflow charge: 2.5 XLM (#1)");
    expect(unfold(calendar)).toContain(`Merchant: ${MERCHANT}`);
  });

  it("orders events by the next charge date", () => {
    const calendar = buildUpcomingChargesCalendar(
      [
        mandate({ id: 2, next_charge: NEXT + 86_400 }),
        mandate({ id: 1, next_charge: NEXT }),
      ],
      { now: NOW },
    );
    expect(calendar.indexOf("payflow-mandate-1")).toBeLessThan(
      calendar.indexOf("payflow-mandate-2"),
    );
  });

  it("adds a bounded recurrence only when the charge cap allows it", () => {
    const capped = buildUpcomingChargesCalendar(
      [mandate({ charges_made: 1, max_charges: 4 })],
      { now: NOW },
    );
    expect(capped).toContain("RRULE:FREQ=DAILY;INTERVAL=30;COUNT=3");

    const open = buildUpcomingChargesCalendar([mandate({ max_charges: 0 })], { now: NOW });
    expect(open).not.toContain("RRULE:");
  });

  it("escapes user-controlled text without breaking the file", () => {
    const calendar = buildUpcomingChargesCalendar([mandate()], { now: NOW });
    // The description is a multi-line value, encoded as escaped \n.
    expect(calendar).toContain("DESCRIPTION:Mandate #1\\n2.5 XLM per month\\nMerchant:");
  });

  it("never emits a physical line longer than 75 octets", () => {
    const calendar = buildUpcomingChargesCalendar([mandate()], { now: NOW });
    for (const line of calendar.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("produces a valid empty calendar when nothing is active", () => {
    const calendar = buildUpcomingChargesCalendar([], { now: NOW });
    expect(calendar).toContain("BEGIN:VCALENDAR");
    expect(calendar).not.toContain("BEGIN:VEVENT");
    expect(calendar.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
