import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  // Workspace packages ship TS source: bundle them. Real npm deps stay external.
  noExternal: [/^@slotkeep\//],
  external: [
    "@prisma/client",
    ".prisma/client",
    "bullmq",
    "ioredis",
    "pino",
    "stripe",
    "@sentry/node",
    "luxon",
    "zod",
  ],
});
