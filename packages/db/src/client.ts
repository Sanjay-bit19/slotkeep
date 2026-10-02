import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __slotkeepPrisma?: PrismaClient };

function createClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.PRISMA_LOG_QUERIES === "true" ? ["query", "warn"] : ["warn"],
    errorFormat: "minimal",
  });
}

/**
 * The unscoped client. Application code should almost never use this directly; reach for
 * `forTenant(tenantId)` instead. Legitimate uses: auth adapter, tenant lookup by slug, Stripe
 * webhook resolution (which starts from a Stripe id, not a tenant), and background jobs that
 * re-scope immediately after loading the row.
 */
export const prisma: PrismaClient = globalForPrisma.__slotkeepPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__slotkeepPrisma = prisma;
