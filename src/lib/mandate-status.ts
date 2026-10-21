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
