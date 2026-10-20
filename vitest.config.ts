import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Component tests use JSX; keep the automatic runtime so the config does
  // not depend on React being in scope in every test file.
  esbuild: { jsx: "automatic" },
  test: {
    // Pure logic runs in node; component tests opt into jsdom per file with
    // `// @vitest-environment jsdom`.
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      // v8 is the zero-instrumentation provider: it reads the engine's own
      // counters, so enabling coverage does not slow the suite down.
      provider: "v8",
      // Only src/lib is held to a threshold — the pure functions the issues
      // ask to keep testable. React pages are covered by jsdom tests but
      // their rendering code is excluded from the report.
      include: ["src/lib/**"],
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      // Thresholds are set at the suite's current coverage of src/lib
      // (measured 2026-10-20: 80.23% stmts/lines, 90.89% branches, 77.06%
      // functions; rounded down to whole numbers so trivial v8 count jitter
      // cannot fail a green suite). A change that lowers coverage fails CI
      // and must raise the number again in the same PR.
      thresholds: {
        lines: 80,
        functions: 77,
        branches: 90,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
