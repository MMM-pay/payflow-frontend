/** Type declarations for scripts/check-js-budget.mjs. */

export interface Budgets {
  default?: number;
  routes?: Record<string, number>;
}

export interface Measurement {
  route: string;
  bytes: number;
}

export interface Verdict {
  route: string;
  kilobytes: number;
  budgetKilobytes: number | null;
  ok: boolean;
}

export function scriptSources(html: string): string[];
export function assetFile(src: string): string;
export function budgetFor(route: string, budgets: Budgets): number | null;
export function checkRoutes(measurements: Measurement[], budgets: Budgets): Verdict[];
