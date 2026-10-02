/** Environment for integration tests. Imported by both the global setup and per-file setup. */
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgresql://postgres:postgres@localhost:5432/slotkeep_test?schema=public&connection_limit=30";

export function applyTestEnv(): void {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = process.env.REDIS_URL_TEST ?? "redis://localhost:6379/15";
  process.env.MANAGE_TOKEN_SECRET ??= "integration-test-manage-secret";
  process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_integration_test_secret";
  process.env.PAYMENTS_MODE ??= "fake";
  process.env.APP_URL ??= "http://localhost:3000";
  process.env.AUTH_SECRET ??= "integration-test-auth-secret-0123456789";
  process.env.RATE_LIMIT_DISABLED ??= "true";
  process.env.LOG_LEVEL ??= "silent";
  (process.env as Record<string, string>).NODE_ENV = "test";
}
