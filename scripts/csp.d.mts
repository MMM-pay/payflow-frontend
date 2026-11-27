/** Types for csp.mjs, which test/csp.test.ts and next.config.mjs import. */
export function cspConnectSources(): string[];
export function cspPolicy(hashes: string[]): string;
export function inlineScriptHashes(html: string): string[];
export function withInlineScriptHashes(html: string): string;
export function applyCspToExport(directory?: string): Promise<void>;
