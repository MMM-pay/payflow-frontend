/**
 * Detection of contracts that are newer than this app.
 *
 * There is no version method on the deployed contracts, so a version number
 * cannot be read. What can be observed is the shape of the records they
 * return: a contract that adds a field (or a status variant) returns keys this
 * build does not know about. That is evidence of a newer contract, not an
 * error — the app keeps reading the fields it understands and shows a notice
 * instead of silently hiding the new behaviour.
 *
 * The detection is deliberately one-directional. A contract that is older
 * simply lacks optional fields, which every reader already treats as "cannot
 * say", so it needs no notice.
 */

export type ContractKind = "plan" | "mandate";

/**
 * The fields this build knows how to read. Keep in step with `Plan` and
 * `Mandate` in `payflow-core.ts`; a field added there without being listed
 * here would make every read look like a newer contract.
 */
export const KNOWN_FIELDS: Record<ContractKind, readonly string[]> = {
  plan: [
    "id",
    "merchant",
    "name",
    "token",
    "amount",
    "period",
    "active",
    "trial",
    "available_until",
    "max_subscribers",
    // Indexer-only columns. They are part of the app's known shape just as
    // much as the contract fields, so they must not read as drift.
    "subscriber_count",
    "ledger",
  ],
  mandate: [
    "id",
    "subscriber",
    "plan_id",
    "merchant",
    "token",
    "amount",
    "period",
    "next_charge",
    "last_charge",
    "charges_made",
    "max_charges",
    "fee_bps",
    "status",
    "trial",
    "discount_bps",
    "discount_charges",
    "discount_charges_made",
    "pause_until",
    "past_due_until",
    "refundable_amount",
    "pending_subscriber",
    // Indexer-only column: who cancelled, which contract state cannot say.
    "ended_by",
  ],
};

/** The mandate status variants this build has copy and behaviour for. */
export const KNOWN_MANDATE_STATUSES: readonly string[] = [
  "Active",
  "Paused",
  "Cancelled",
  "Completed",
  "PastDue",
];

export interface ContractDrift {
  /** True when a record carried something this build does not know. */
  newer: boolean;
  /** Record fields that were not recognised, sorted for stable output. */
  unknownFields: string[];
  /** A status variant that was not recognised, or null. */
  unknownStatus: string | null;
}

export const NO_DRIFT: ContractDrift = {
  newer: false,
  unknownFields: [],
  unknownStatus: null,
};

/** Read the status the same way `mandateStatus` does, without importing it. */
function statusName(raw: unknown): string {
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  return typeof raw === "string" ? raw : "";
}

/**
 * Compare one decoded contract record against the shape this build knows.
 *
 * Values are not inspected beyond presence: an optional field that exists but
 * is null is still part of the contract's schema. A non-object (an indexer
 * error body, a malformed simulation result) is not evidence of a newer
 * contract, so it reports no drift rather than alarming the reader.
 */
export function contractDrift(kind: ContractKind, value: unknown): ContractDrift {
  if (!value || typeof value !== "object" || Array.isArray(value)) return NO_DRIFT;

  const known = new Set(KNOWN_FIELDS[kind]);
  const unknownFields = Object.keys(value as Record<string, unknown>)
    .filter((key) => !known.has(key))
    .sort();

  const unknownStatus =
    kind === "mandate" && "status" in value
      ? (() => {
          const status = statusName((value as { status?: unknown }).status);
          return status && !KNOWN_MANDATE_STATUSES.includes(status) ? status : null;
        })()
      : null;

  return {
    newer: unknownFields.length > 0 || unknownStatus !== null,
    unknownFields,
    unknownStatus,
  };
}

/**
 * The drift observed so far in this page life, shared by every reader.
 *
 * Records are observed where they are decoded (`chain.ts`), so the notice can
 * appear on any page without each one re-reading a contract just to look for a
 * version. The object identity only changes when something new is seen, which
 * is what `useSyncExternalStore` needs.
 */
let observed: ContractDrift = NO_DRIFT;
const listeners = new Set<() => void>();

function merge(a: ContractDrift, b: ContractDrift): ContractDrift {
  if (!b.newer) return a;
  const unknownFields = Array.from(new Set([...a.unknownFields, ...b.unknownFields])).sort();
  return {
    newer: true,
    unknownFields,
    unknownStatus: a.unknownStatus ?? b.unknownStatus,
  };
}

/** Record a decoded plan or mandate. Safe to call for every read. */
export function observeContractRecord(kind: ContractKind, value: unknown): ContractDrift {
  const next = merge(observed, contractDrift(kind, value));
  if (next !== observed) {
    observed = next;
    listeners.forEach((listener) => listener());
  }
  return next;
}

/**
 * Record a contract error code that has no copy in this build.
 *
 * A newly added `#[contracterror]` variant is another signal that the
 * deployment moved ahead of the app. Unknown codes still reach the user with
 * the generic "#N" sentence, so this only adds the notice.
 */
export function observeUnknownContractError(scope: string, code: number): void {
  observeContractRecord("mandate", { unexpected_error: `${scope}#${code}` });
}

export function getContractDrift(): ContractDrift {
  return observed;
}

export function subscribeContractDrift(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reset between tests, and after a successful app update in a long session. */
export function resetContractDrift(): void {
  observed = NO_DRIFT;
  listeners.forEach((listener) => listener());
}

/** Copy for the notice, with a stable sentence for the source of the drift. */
export function contractDriftMessage(drift: ContractDrift): string {
  if (!drift.newer) return "";
  return "This deployment's contracts are newer than this version of the app. Some new options may not be shown here yet. Everything this page knows about still works — update the app to see the rest.";
}
