import { execSync } from "node:child_process";
import { E2E_ENV } from "../playwright.config";

/**
 * Up-to-date schema + freshly re-created demo tenants + empty queues before every e2e run.
 * Deliberately non-destructive (no `migrate reset`): the seed deletes and recreates only the
 * demo tenants, and every test uses unique customer emails.
 */
export default async function globalSetup() {
  const env = { ...process.env, ...E2E_ENV };
  execSync("pnpm --filter @slotkeep/db exec prisma migrate deploy", { stdio: "inherit", env });
  execSync("pnpm --filter @slotkeep/db seed", { stdio: "inherit", env });
  const { Redis } = await import("ioredis");
  const r = new Redis(E2E_ENV.REDIS_URL!);
  await r.flushdb();
  await r.quit();
}
