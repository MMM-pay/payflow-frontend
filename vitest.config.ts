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
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
