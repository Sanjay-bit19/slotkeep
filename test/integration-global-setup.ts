import { execSync } from "node:child_process";
import { applyTestEnv, TEST_DATABASE_URL } from "./integration-env";

export default function setup(): void {
  applyTestEnv();
  execSync("pnpm --filter @slotkeep/db exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
