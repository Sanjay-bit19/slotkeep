import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const here = path.dirname(fileURLToPath(import.meta.url));

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@slotkeep/core", "@slotkeep/db", "@slotkeep/infra"],
  // BullMQ loads Lua scripts from disk and pino/ioredis rely on Node internals: keep them external.
  serverExternalPackages: ["bullmq", "ioredis", "pino", "@prisma/client", ".prisma/client"],
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: path.join(here, "../.."),
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Source map upload only happens when SENTRY_AUTH_TOKEN is present (CI release builds).
export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: process.env.SENTRY_RELEASE ? { name: process.env.SENTRY_RELEASE } : undefined,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
});
