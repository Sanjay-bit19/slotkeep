import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_BASE_URL = `http://localhost:${PORT}`;

/**
 * Environment shared by the Next server, the worker, and the test process (which reads the
 * database directly to fetch magic links and assert state).
 */
export const E2E_ENV: Record<string, string> = {
  DATABASE_URL:
    process.env.E2E_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/slotkeep_e2e?schema=public",
  REDIS_URL: process.env.E2E_REDIS_URL ?? "redis://localhost:6379/14",
  APP_URL: E2E_BASE_URL,
  AUTH_URL: E2E_BASE_URL,
  AUTH_SECRET: "e2e-auth-secret-0123456789abcdefghij",
  AUTH_TRUST_HOST: "true",
  MANAGE_TOKEN_SECRET: "e2e-manage-token-secret-0123456789",
  PAYMENTS_MODE: process.env.STRIPE_E2E === "1" ? "stripe" : "fake",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_e2e_secret",
  ENABLE_DEV_MAILBOX: "true",
  RATE_LIMIT_DISABLED: "true",
  LOG_LEVEL: "warn",
  WORKER_HEALTH_PORT: String(PORT + 1),
};

const chromiumPath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "America/Chicago",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
  webServer: [
    {
      // Production build is created beforehand (`pnpm build`); we test what ships.
      command: `pnpm exec next start --port ${PORT}`,
      url: `${E2E_BASE_URL}/api/health`,
      env: E2E_ENV,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @slotkeep/worker exec tsx src/index.ts",
      url: `http://localhost:${PORT + 1}/health`,
      env: { ...E2E_ENV, SERVICE_NAME: "worker" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
