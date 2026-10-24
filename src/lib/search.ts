import { StrKey } from "@stellar/stellar-sdk";

/**
 * One place the header search can take the user. `label` is a catalog key
 * and `values` fill its placeholders, so the component can translate it.
 */
export interface SearchTarget {
  label: string;
  values?: Record<string, string>;
  href: string;
}

/** What a query looks like, decided without any network call. */
export type ParsedQuery =
  | { kind: "address"; address: string }
  | { kind: "id"; id: number }
  | { kind: "text"; text: string }
  | { kind: "empty" };

/**
 * Classify what the user typed. A `G…` account address, a number (with or
 * without a leading `#`), or free text for plan names. Anything shorter than
 * two characters of text is treated as empty so a single keystroke does not
 * search.
 */
export function parseQuery(raw: string): ParsedQuery {
  const q = raw.trim();
  if (!q) return { kind: "empty" };
  if (StrKey.isValidEd25519PublicKey(q)) return { kind: "address", address: q };
  const id = /^#?(\d{1,15})$/.exec(q);
  if (id) {
    const n = Number(id[1]);
    if (Number.isSafeInteger(n) && n > 0) return { kind: "id", id: n };
  }
  if (q.length < 2) return { kind: "empty" };
  return { kind: "text", text: q };
}

/**
 * Destinations for an address or an id. Plan-name results come from
 * `planTargets`, because they need the plan list.
 */
export function directTargets(query: ParsedQuery): SearchTarget[] {
  switch (query.kind) {
    case "address":
      return [
        { label: "Merchant page", href: `/m/?address=${query.address}` },
        { label: "Subscriptions of this account", href: `/account/?address=${query.address}` },
      ];
    case "id": {
      const id = String(query.id);
      return [
        { label: "Mandate #{id}", values: { id }, href: `/mandates/?id=${id}` },
        { label: "Plan #{id}", values: { id }, href: `/plans/${id}` },
      ];
    }
    default:
      return [];
  }
}

/** Plans whose name contains `text`, case-insensitively, at most `limit`. */
export function planTargets(
  plans: { id: number; name: string }[],
  text: string,
  limit = 8,
): SearchTarget[] {
  const needle = text.toLocaleLowerCase();
  return plans
    .filter((p) => p.name && p.name.toLocaleLowerCase().includes(needle))
    .slice(0, limit)
    .map((p) => ({
      label: "{name} (plan #{id})",
      values: { name: p.name, id: String(p.id) },
      href: `/plans/${p.id}`,
    }));
}
