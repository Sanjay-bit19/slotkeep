import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("./apps/web", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": webRoot },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**/*.ts"],
      exclude: ["**/index.ts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts", "apps/*/test/unit/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["packages/*/test/**/*.int.test.ts", "apps/*/test/integration/**/*.int.test.ts"],
          environment: "node",
          globalSetup: ["./test/integration-global-setup.ts"],
          setupFiles: ["./test/integration-setup.ts"],
          // Tests share one database; run files serially in one process to keep truncation simple.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
          // next-auth ships ESM with extensionless "next/server" imports; let Vite resolve them.
          server: { deps: { inline: ["next-auth", "@auth/core"] } },
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
