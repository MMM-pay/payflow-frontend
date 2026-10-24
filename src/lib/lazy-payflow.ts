"use client";

import type * as PayflowModule from "./payflow";

/**
 * The one SDK-bound module, loaded on demand and only once.
 *
 * Importing `payflow.ts` statically pulls the Stellar SDK (~570 kB) into a
 * route's first-load bundle, even on pages that only touch the contracts after
 * a click. Holding the promise here means the module graph is entered exactly
 * once per page life, rather than each caller writing its own dynamic import —
 * which both duplicates the import site across chunks and, under Vitest, can
 * re-enter the mock registry and evaluate the real SDK-backed module.
 */
let promise: Promise<typeof PayflowModule> | null = null;

export function loadPayflow(): Promise<typeof PayflowModule> {
  if (!promise) promise = import("./payflow");
  return promise;
}

/** Forwards every method call to `mod[name]`, loading the module first. */
function lazyProxy<T extends object>(pick: (mod: typeof PayflowModule) => unknown): T {
  return new Proxy({} as T, {
    get(_target, name: string) {
      return (...args: unknown[]) =>
        loadPayflow().then((mod) => {
          const target = pick(mod) as Record<string, (...a: unknown[]) => unknown>;
          const method = target[name];
          if (typeof method !== "function") {
            throw new TypeError(`${name} is not a function on the loaded module`);
          }
          return method.apply(target, args);
        });
    },
  });
}

/**
 * The contract client, with the module fetched on first use.
 *
 * Every method on it is async, so a call can wait for the module without the
 * call site changing shape: `payflow.deposit(...)` reads the same as before
 * and still returns a promise. Only methods are proxied — anything needing a
 * value synchronously must await `loadPayflow()` itself.
 */
export const payflow = lazyProxy<typeof PayflowModule.payflow>((mod) => mod.payflow);

/** The RPC client, likewise fetched on first use. */
export const server = lazyProxy<typeof PayflowModule.server>((mod) => mod.server);
