/**
 * Billing periods on the merchant's publish form.
 *
 * The plan registry stores a period as a plain count of seconds (`u64`) and
 * refuses anything under 60 (`plan_registry` contracterror #6), so the length
 * itself is the merchant's to choose — fortnightly, quarterly, every 100 days.
 * All this module does is convert a chosen number of days/weeks/months into
 * whole seconds and refuse anything the chain would refuse, so the form can
 * disable Publish *before* the wallet opens instead of paying for a failed
 * simulation.
 *
 * Pure functions on purpose: `test/period.test.ts` checks them without
 * rendering React, and the page holds no period arithmetic of its own.
 * Nothing here imports the SDK or the config, so it stays usable from any
 * context — including contract-only mode, where the period is local form
 * state and never touches the backend.
 */

/**
 * The contract's floor, mirrored from `plan_registry`'s contracterror #6.
 * `create_plan` rejects a shorter period, so the form rejects it first.
 */
export const MIN_PERIOD_SECONDS = 60;

/**
 * The wording the contract's own error map produces (`ERRORS` in
 * `src/lib/payflow.ts`, shared with this module so the message in the form
 * and the message from a failed simulation can never drift apart).
 */
export const MIN_PERIOD_MESSAGE = "Billing period must be at least 60 seconds.";

/**
 * Longer than `Number` can hold as an exact integer. `create_plan` takes a
 * `u64`, but a period past 2^53 seconds would be rounded by the `number` the
 * form passes — publishing a length nobody chose — so it is refused here.
 */
export const TOO_LONG_MESSAGE = "That period is too long — pick a smaller number.";

/** Why a period cannot be submitted, or the period itself in whole seconds. */
export type PeriodCheck = { ok: true; seconds: number } | { ok: false; message: string };

/** A preset offered in the period picker, labelled as the option shows it. */
export interface PeriodPreset {
  label: string;
  /** Seconds between charges. */
  value: number;
}

/**
 * The presets the form offered before custom lengths existed, unchanged so a
 * merchant who relied on them sees the same list in the same order.
 */
export const PERIOD_PRESETS: ReadonlyArray<PeriodPreset> = [
  { label: "Every minute (demo)", value: 60 },
  { label: "Daily", value: 86_400 },
  { label: "Weekly", value: 604_800 },
  { label: "Monthly", value: 2_592_000 },
  { label: "Yearly", value: 31_536_000 },
];

/** The sentinel the period picker's `<select>` uses for "Custom…". */
export const CUSTOM_PERIOD = "custom";

/** The preset the form opens on: monthly, exactly as the old default. */
export const DEFAULT_PERIOD = 2_592_000;

/** One of the units a custom period may be counted in. */
export interface PeriodUnit {
  /** Singular name, used verbatim in validation messages. */
  name: string;
  /** How many seconds one of these is. */
  seconds: number;
}

/**
 * 30-day months, not calendar months: the contract only knows seconds, and
 * 2_592_000 is the same figure the "Monthly" preset has always used, so a
 * custom quarterly plan and a preset monthly plan stay on one scale.
 */
const DAY_UNIT: PeriodUnit = { name: "day", seconds: 86_400 };

export const PERIOD_UNITS: ReadonlyArray<PeriodUnit> = [
  DAY_UNIT,
  { name: "week", seconds: 604_800 },
  { name: "month", seconds: 2_592_000 },
];

/**
 * The unit a `<select>` value names, falling back to days when the value is
 * missing or unknown — an unrecognised value must not become `undefined`
 * seconds, which would publish a period of 0.
 */
export function unitFor(name: string | null | undefined): PeriodUnit {
  return PERIOD_UNITS.find((u) => u.name === name) ?? DAY_UNIT;
}

/** The option text for a unit, e.g. "Days". */
export function unitLabel(unit: PeriodUnit): string {
  return `${unit.name.charAt(0).toUpperCase()}${unit.name.slice(1)}s`;
}

/**
 * Validate a period already expressed in seconds against the contract's
 * rules: a real, whole, at-least-60-second, exactly-representable number.
 */
export function checkPeriodSeconds(seconds: number): PeriodCheck {
  // Not-a-number and infinity land here too: both are below no threshold, so
  // the finite check comes first rather than falling through to "too long".
  if (!Number.isFinite(seconds) || seconds < MIN_PERIOD_SECONDS) {
    return { ok: false, message: MIN_PERIOD_MESSAGE };
  }
  if (!Number.isSafeInteger(seconds)) {
    return { ok: false, message: TOO_LONG_MESSAGE };
  }
  return { ok: true, seconds };
}

/**
 * Validate a merchant's custom period: a whole count of a chosen unit,
 * converted to seconds and then checked like any other period.
 *
 * Digits only, deliberately. The field is `type="number"`, but that still
 * admits "-", "1e4" and "2.5" — a half-typed "14." must read as "keep
 * typing", not as a period of 14 days and a fraction, so anything that is not
 * a plain whole number is refused with the reason.
 *
 * Zero survives parsing on purpose: it is the only way a count of
 * days/weeks/months reaches the contract's floor, so it is what carries the
 * "at least 60 seconds" message out of `checkPeriodSeconds`.
 */
export function checkCustomPeriod(count: string, unitName: string): PeriodCheck {
  const text = count.trim();
  const unit = unitFor(unitName);
  const plural = `${unit.name}s`;
  if (text.startsWith("-")) {
    return { ok: false, message: `Enter a positive number of ${plural}.` };
  }
  if (text === "" || !/^\d+$/.test(text)) {
    return { ok: false, message: `Enter a whole number of ${plural}.` };
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n)) {
    return { ok: false, message: TOO_LONG_MESSAGE };
  }
  return checkPeriodSeconds(n * unit.seconds);
}
