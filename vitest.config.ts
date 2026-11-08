import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `@scm-js/core` is read from its sources until the mods branch is published (README: "Before publishing").
export default defineConfig({
  resolve: { alias: { "@scm-js/core": fileURLToPath(new URL("./node_modules/@scm-js/core/src/index.ts", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 120_000 },
});
