import type { ApiMandate } from "./api";
import { formatPeriod, fromStroops } from "./format";

/**
 * Builds an iCalendar (.ics) file for the upcoming charges of a subscriber's
 * active mandates. The output is plain text, so it works in contract-only mode:
 * the mandates come from whichever source (indexer or chain) the page already
 * used, and no network call happens here.
 *
 * Only `Active` mandates are included. A paused mandate has no reliable next
 * charge, and a cancelled or completed one will never charge again.
 */

export const CALENDAR_FILENAME = "payflow-upcoming-charges.ics";

/** How long a calendar block occupies; these are reminders, not bookings. */
const EVENT_DURATION_SECONDS = 15 * 60;

export interface CalendarOptions {
  /** Unix seconds. Injectable so tests do not depend on the wall clock. */
  now?: number;
}

/** Format a Unix timestamp as the UTC form iCalendar requires. */
export function toIcsDate(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Escape a text value for an iCalendar property. Backslash must be replaced
 * first, otherwise the escapes added for `;` and `,` get doubled.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold a content line at 75 octets, as RFC 5545 requires. Continuation lines
 * begin with a single space, so they carry 74 content octets. Folding walks
 * whole code points to avoid splitting a multi-byte character.
 */
export function foldIcsLine(line: string, limit = 75): string {
  if (new TextEncoder().encode(line).length <= limit) return line;

  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  // The first line may use `limit` bytes; each continuation loses one to the
  // leading space.
  let available = limit;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > available) {
      parts.push(current);
      current = "";
      bytes = 0;
      available = limit - 1;
    }
    current += char;
    bytes += size;
  }
  if (current) parts.push(current);
  return parts.join("\r\n ");
}

/**
 * The recurrence rule for a mandate whose charge cap is known.
 *
 * The contract stores periods as fixed second counts, so "monthly" is exactly
 * 30 days rather than a calendar month. Expressing that as DAILY;INTERVAL=30
 * keeps the calendar in step with the contract; FREQ=MONTHLY would drift.
 *
 * Returns null when there is only the next charge left (or the mandate is
 * open-ended). The task deliberately limits recurrence to capped mandates:
 * an open-ended mandate has no end and would either recur forever or need an
 * arbitrary horizon.
 */
export function recurrenceRule(m: Pick<ApiMandate, "period" | "charges_made" | "max_charges">): string | null {
  const remaining = m.max_charges > 0 ? m.max_charges - m.charges_made : 0;
  if (remaining <= 1) return null;

  const period = m.period;
  if (period <= 0) return null;

  let frequency: string;
  let interval: number;
  if (period % 604_800 === 0) {
    frequency = "WEEKLY";
    interval = period / 604_800;
  } else if (period % 86_400 === 0) {
    frequency = "DAILY";
    interval = period / 86_400;
  } else if (period % 3_600 === 0) {
    frequency = "HOURLY";
    interval = period / 3_600;
  } else if (period % 60 === 0) {
    frequency = "MINUTELY";
    interval = period / 60;
  } else {
    frequency = "SECONDLY";
    interval = period;
  }

  return `FREQ=${frequency};INTERVAL=${interval};COUNT=${remaining}`;
}

function buildEvent(m: ApiMandate, stamp: string): string[] {
  const start = toIcsDate(m.next_charge);
  const end = toIcsDate(m.next_charge + EVENT_DURATION_SECONDS);
  const amount = fromStroops(m.amount);
  const description = [
    `Mandate #${m.id}`,
    `${amount} XLM ${formatPeriod(m.period)}`,
    `Merchant: ${m.merchant}`,
  ].join("\n");

  const lines = [
    "BEGIN:VEVENT",
    `UID:payflow-mandate-${m.id}@payflow.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(`Payflow charge: ${amount} XLM (#${m.id})`)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
  ];

  const rule = recurrenceRule(m);
  if (rule) lines.push(`RRULE:${rule}`);

  lines.push("END:VEVENT");
  return lines;
}

/**
 * Build a complete VCALENDAR for the next charge of every active mandate.
 * Mandates without a scheduled next charge are skipped, which also keeps a
 * malformed `next_charge: 0` from producing an event in 1970.
 */
export function buildUpcomingChargesCalendar(
  mandates: ApiMandate[],
  options: CalendarOptions = {},
): string {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const stamp = toIcsDate(now);

  const events = mandates
    .filter(
      (m) =>
        m.status === "Active" &&
        m.next_charge > 0 &&
        // A capped mandate that has already used every charge is only still
        // "Active" while the indexer catches up with the contract.
        !(m.max_charges > 0 && m.charges_made >= m.max_charges),
    )
    .sort((a, b) => a.next_charge - b.next_charge)
    .flatMap((m) => buildEvent(m, stamp));

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Payflow//Upcoming charges//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Payflow upcoming charges",
    ...events,
    "END:VCALENDAR",
  ];

  return lines.map((line) => foldIcsLine(line)).join("\r\n") + "\r\n";
}
