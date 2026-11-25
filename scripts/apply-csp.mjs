/**
 * CLI for the post-export CSP step (`npm run build`).
 *
 * The rules live in `scripts/csp.mjs` so `next.config.mjs` can share the
 * connect-source list with the step that writes the policy.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { applyCspToExport } from "./csp.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await applyCspToExport();
}
