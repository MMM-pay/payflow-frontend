/** Types for apply-csp.mjs, which test/csp.test.ts imports. */
export function buildCspContent(scriptHashes: string[]): string;
export function withCsp(html: string): string;
export function applyCspToExport(directory?: string): Promise<void>;
