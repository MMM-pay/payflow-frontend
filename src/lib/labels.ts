/**
 * Local labels for addresses.
 *
 * Users attach a friendly name to any address (account or
 * contract) and it is stored in localStorage. The logic is kept
 * pure so it can be tested without React or a browser.
 *
 * Storage is always wrapped in try/catch: when it is blocked
 * (private mode, disabled cookies, a quota error) the app falls back
 * to no labels silently and never throws.
 */

export const LABELS_STORAGE_KEY = "payflow.labels.v1";

export const MAX_LABEL_LENGTH = 40;

export type LabelMap = Record<string, string>;

/** Trim whitespace and collapse runs of inner spaces. */
export function normalizeLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
}

export function parseLabels(raw: string | null): LabelMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: LabelMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && typeof v === "string") {
        const label = normalizeLabel(v);
        if (label) out[k] = label;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeLabels(labels: LabelMap): string {
  return JSON.stringify(labels);
}

export function getLabel(labels: LabelMap, address: string): string | undefined {
  return labels[address];
}

export function setLabel(labels: LabelMap, address: string, raw: string): LabelMap {
  const label = normalizeLabel(raw);
  const next = { ...labels };
  if (!label) {
    delete next[address];
  } else {
    next[address] = label;
  }
  return next;
}

export function removeLabel(labels: LabelMap, address: string): LabelMap {
  const next = { ...labels };
  delete next[address];
  return next;
}

/** Read labels from storage, swallowing any error (blocked storage, etc). */
export function readLabels(storage: Storage | null | undefined): LabelMap {
  if (!storage) return {};
  try {
    return parseLabels(storage.getItem(LABELS_STORAGE_KEY));
  } catch {
    return {};
  }
}

/** Write labels to storage. Returns false if storage is blocked. */
export function writeLabels(storage: Storage | null | undefined, labels: LabelMap): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LABELS_STORAGE_KEY, serializeLabels(labels));
    return true;
  } catch {
    return false;
  }
}
