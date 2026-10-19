import type { ApiMandate } from "./api";
import { formatDate, formatWhen } from "./format";

/**
 * Free trials on plans.
 *
 * Depends on payflow-contract#9, which has not shipped. The proposed interface
 * is `Plan.trial: u64` — seconds, 0 meaning none — with `subscribe` setting
 * `next_charge = now + trial` and copying `trial` into the `Subscribed` event.
 *
 * Until that lands, neither the deployed contract's `Plan` nor the indexer's
 * rows carry the field. So every reader here treats it as optional and absent
 * means "no trial", and the merchant form hides its trial control entirely when
 * the deployed contract does not answer with one. Nothing degrades to a wrong
 * number: an unsupported deployment shows no badge at all rather than a zero
 * that reads as "this plan has no trial" when it simply cannot be told.
 */

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

/** Anything carrying an optional trial length in seconds. */
export interface HasTrial {
  trial?: unknown;
}

/**
 * The trial length in seconds, or 0 when there is none or the field is
 * missing/unusable.
 *
 * `scValToNative` decodes a `u64` as a bigint and the indexer sends a JSON
 * number, so both have to be accepted. A plan whose trial is nonsense must not
 * become a badge reading "NaN-day free trial".
 */
export function trialSeconds(plan: HasTrial | null | undefined): number {
  const raw = plan?.trial;
  if (raw === undefined || raw === null) return 0;
  const n = typeof raw === "bigint" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

/** Whether the value has a trial, i.e. whether a badge belongs on the card. */
export function hasTrial(plan: HasTrial | null | undefined): boolean {
  return trialSeconds(plan) > 0;
}

/**
 * Whether the source can represent trials at all.
 *
 * This is the gate for showing the merchant's trial control. It is answered
 * from data, not from a flag: a contract built before the change returns a
 * `Plan` map with no `trial` key, so `trial` is `undefined` rather than 0, and
 * the control must stay hidden — passing the extra argument to that contract's
 * `create_plan` would fail every publish.
 */
export function supportsTrials(source: HasTrial | null | undefined): boolean {
  const raw = source?.trial;
  return typeof raw === "number" || typeof raw === "bigint";
}

/**
 * The badge text for a trial, or null when the plan has none.
 *
 * Null rather than "" so a caller cannot accidentally render an empty pill:
 * "no badge for plans without a trial" is the acceptance criterion, and the
 * cheapest way to hold it is for the function that decides the text to decline
 * rather than return nothing to show.
 */
export function trialBadge(plan: HasTrial | null | undefined): string | null {
  const seconds = trialSeconds(plan);
  if (seconds === 0) return null;
  return `${trialAdjective(seconds)} free trial`;
}

/**
 * The trial length split into its count and unit, e.g. [14, "day"].
 *
 * Days rather than weeks, deliberately: a merchant picks "14 days" from the
 * preset list, and a card that then reads "2-week free trial" contradicts the
 * control they set it with.
 */
function splitTrialLength(seconds: number): [number, string] {
  const units: Array<[string, number]> = [
    ["day", DAY],
    ["hour", HOUR],
    ["minute", MINUTE],
  ];
  for (const [label, size] of units) {
    if (seconds >= size && seconds % size === 0) {
      return [seconds / size, label];
    }
  }
  // A length that divides into no whole unit — a 90-minute trial, say. Seconds
  // are the honest unit rather than rounding to a day the merchant never chose.
  return [seconds, "second"];
}

/**
 * "14-day": the adjectival form a badge needs.
 *
 * The unit stays singular because it is modifying a noun — "14-day free
 * trial", not "14-days free trial".
 */
export function trialAdjective(seconds: number): string {
  const [n, unit] = splitTrialLength(seconds);
  return `${n}-${unit}`;
}

/** "14 days", "1 hour", "45 minutes": the same length as a plain duration. */
export function formatTrialLength(seconds: number): string {
  const [n, unit] = splitTrialLength(seconds);
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** Mandates in these states will never charge again, so they cannot be trialing. */
const TERMINAL = new Set(["Cancelled", "Completed"]);

/**
 * When a mandate's trial ends, in unix seconds, or null when it has none.
 *
 * While the trial runs, `next_charge` *is* the trial end: `subscribe` sets it
 * to `now + trial` and the first charge happens when it is reached. Once that
 * charge settles, `next_charge` moves on to the next period and there is no
 * trial left to report.
 *
 * This deliberately requires the mandate to actually carry a `trial`. Inferring
 * it from `next_charge` alone would claim a trial on every mandate whose first
 * period has not arrived yet, which is every mandate ever opened on a plan
 * without one — so a subscriber would be told their free trial ended on a date
 * that was never a trial.
 */
export function trialEndsAt(
  mandate: Pick<ApiMandate, "charges_made" | "next_charge" | "status" | "trial">,
): number | null {
  if (trialSeconds(mandate) === 0) return null;
  if (mandate.charges_made > 0) return null;
  // A cancelled mandate has no trial left to end, and "free trial ends in 3d,
  // cancel before then" on a mandate that is already cancelled is nonsense.
  if (TERMINAL.has(mandate.status)) return null;
  return mandate.next_charge > 0 ? mandate.next_charge : null;
}

/**
 * "Free trial ends 22 Nov 2026 (in 3d)", or null when there is no trial.
 *
 * The absolute date is the point — "in 3d" is meaningless once the tab has
 * been open a week — and the relative part says whether it is still ahead.
 */
export function describeTrialEnd(
  mandate: Pick<ApiMandate, "charges_made" | "next_charge" | "status" | "trial">,
  now: number = Math.floor(Date.now() / 1000),
): string | null {
  const ends = trialEndsAt(mandate);
  if (ends === null) return null;
  // The same reference instant drives both halves, so the wording and the
  // relative time can never contradict each other.
  const relative = formatWhen(ends, now * 1000);
  const past = ends <= now;
  return past
    ? `Free trial ended ${formatDate(ends)} (${relative})`
    : `Free trial ends ${formatDate(ends)} (${relative})`;
}

/**
 * Trial lengths a merchant can publish.
 *
 * Offered as fixed presets rather than a free-text field: the value goes into
 * a `u64` the contract reads forever, and a mis-typed "14 deays" would either
 * be rejected on-chain or, worse, accepted as an unintended duration.
 */
export const TRIAL_OPTIONS: ReadonlyArray<{ label: string; seconds: number }> = [
  { label: "3 days", seconds: 3 * DAY },
  { label: "7 days", seconds: 7 * DAY },
  { label: "14 days", seconds: 14 * DAY },
  { label: "30 days", seconds: 30 * DAY },
];

/** The preset a trial length matches, or null when it matches none. */
export function matchingTrialOption(seconds: number) {
  return TRIAL_OPTIONS.find((o) => o.seconds === seconds) ?? null;
}