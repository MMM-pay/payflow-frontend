import { config } from "./config";

/**
 * Shareable links.
 *
 * A merchant sends a customer to one plan, not to the whole catalogue. The
 * link is a query parameter on the subscribe page — `/subscribe/?plan=12` —
 * because the app is a static export: every route is one prebuilt file, so
 * per-plan state has to arrive at runtime rather than as a path segment.
 *
 * The base path is part of the link. On GitHub Pages the app is served from
 * `/payflow-frontend`, and a link without it lands on 404.
 */

/** The absolute link that opens one plan on the subscribe page. */
export function subscribeLink(
  origin: string,
  planId: number | bigint,
  basePath: string = config.basePath,
): string {
  const host = origin.replace(/\/+$/, "");
  const path = basePath.replace(/\/+$/, "");
  return `${host}${path}/subscribe/?plan=${planId}`;
}

/**
 * The link that opens the whole catalogue, used as the "see all plans" target
 * and as the fallback when a plan link points at a plan that no longer exists.
 */
export function catalogueLink(origin: string, basePath: string = config.basePath): string {
  const host = origin.replace(/\/+$/, "");
  const path = basePath.replace(/\/+$/, "");
  return `${host}${path}/subscribe/`;
}

/** What a `?plan=` parameter asks for. */
export type PlanParam =
  /** No parameter: show every plan. */
  | { kind: "all" }
  /** A plan id: show that plan alone. */
  | { kind: "plan"; id: number }
  /** A parameter that cannot be a plan id: show every plan, and say so. */
  | { kind: "invalid" };

/**
 * Read a `?plan=` parameter.
 *
 * Plans are numbered from 1, so "0" and a negative number name no plan. A
 * parameter that is not a whole number is "invalid" rather than "all": the
 * link was typed by hand or truncated, and the page says so instead of
 * quietly showing the whole catalogue as if nothing had happened.
 */
export function planParam(raw: string | null | undefined): PlanParam {
  if (raw === null || raw === undefined || raw.trim() === "") return { kind: "all" };
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return { kind: "invalid" };
  const id = Number(trimmed);
  if (!Number.isSafeInteger(id) || id < 1) return { kind: "invalid" };
  return { kind: "plan", id };
}
