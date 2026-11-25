/**
 * Mandate status normalisation.
 *
 * A `#[contracttype]` enum variant without data is encoded as a vector holding
 * its name, so contract state decodes as `["Active"]`, not `"Active"`. The
 * indexer sends the plain string. Every reader must handle both — comparing
 * the raw value is how a contract-only page ends up treating an active mandate
 * as unknown.
 *
 * This lives in its own module so pure helpers (for example reminders) can use
 * it without importing the contract SDK and its RPC client.
 */
export function mandateStatus(raw: unknown): string {
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return String(raw ?? "");
}

/** The three sections a subscriber's subscription list is grouped into. */
export type MandateGroupKey = "active" | "paused" | "ended";

/**
 * Which section a mandate belongs in.
 *
 * Only "Active" and "Paused" are their own sections; cancelled, completed and
 * anything this build does not recognise are grouped under "ended" so a
 * future status cannot silently disappear from the list.
 */
export function mandateGroup(raw: unknown): MandateGroupKey {
  const status = mandateStatus(raw);
  if (status === "Active") return "active";
  if (status === "Paused") return "paused";
  return "ended";
}

/**
 * Group mandates into active, paused and ended sections in that order.
 *
 * The input order is preserved inside each section, so the caller's sort
 * survives the grouping. Empty sections are returned too — the caller decides
 * whether to render a heading for a section it would leave empty.
 */
export function groupMandatesByStatus<T extends { status: unknown }>(
  mandates: readonly T[],
): Array<{ key: MandateGroupKey; mandates: T[] }> {
  const groups: Record<MandateGroupKey, T[]> = {
    active: [],
    paused: [],
    ended: [],
  };
  for (const mandate of mandates) {
    groups[mandateGroup(mandate.status)].push(mandate);
  }
  return (["active", "paused", "ended"] as const).map((key) => ({
    key,
    mandates: groups[key],
  }));
}
