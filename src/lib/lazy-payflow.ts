"use client";

import type * as PayflowModule from "./payflow";

/**
 * The one SDK-bound module, loaded on demand and only once.
 *
 * Every caller used to write its own `import("@/lib/payflow")`, which both
 * duplicated the dynamic-import site across chunks and — under Vitest —
 * re-entered the mock registry with a polluted callstack, so the second call
 * in a render tree could evaluate the real SDK-backed module. Holding the
 * promise here means the module graph is entered exactly once per page life.
 */
let promise: Promise<typeof PayflowModule> | null = null;

export function loadPayflow(): Promise<typeof PayflowModule> {
  if (!promise) promise = import("./payflow");
  return promise;
}
