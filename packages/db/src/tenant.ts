import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as basePrisma } from "./client";

/**
 * Models that carry a tenantId column. Every operation on them through a tenant client gets
 * `tenantId` forced into its filter (reads, updates, deletes) or its data (creates).
 */
export const TENANT_MODELS = new Set<string>([
  "Membership",
  "StaffMember",
  "WeeklyAvailability",
  "TimeOff",
  "Service",
  "StaffService",
  "Customer",
  "Booking",
]);

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

function withTenantData<T extends Record<string, unknown>>(
  data: T,
  tenantId: string,
  model: string,
): T {
  if ("tenant" in data) {
    throw new TenantScopeError(
      `${model}: use the scalar tenantId, not a tenant relation, in tenant-scoped writes`,
    );
  }
  if (data.tenantId !== undefined && data.tenantId !== tenantId) {
    throw new TenantScopeError(`${model}: attempted to write a row for another tenant`);
  }
  return { ...data, tenantId };
}

/**
 * Returns a Prisma client where every query on a tenant-owned model is constrained to `tenantId`.
 *
 * Why an extension rather than "remember to add tenantId": a forgotten filter is the single most
 * likely cross-tenant leak in a multi-tenant app, and code review does not reliably catch it.
 * Here a missing filter is impossible for top-level operations. Nested writes and relation reads
 * are covered by composite foreign keys (tenantId, id) in the schema: a child row cannot point at
 * a parent in a different tenant, so reaching data through a relation never crosses tenants.
 */
export function forTenant(tenantId: string, client: PrismaClient = basePrisma) {
  if (!tenantId) throw new TenantScopeError("tenantId is required");
  return client.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const a = (args ?? {}) as Record<string, any>;
          if (WHERE_OPS.has(operation)) {
            a.where = { ...(a.where ?? {}), tenantId };
          } else if (operation === "create") {
            a.data = withTenantData(a.data ?? {}, tenantId, model);
          } else if (operation === "createMany" || operation === "createManyAndReturn") {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((r: Record<string, unknown>) => withTenantData(r, tenantId, model));
          } else if (operation === "upsert") {
            a.where = { ...(a.where ?? {}), tenantId };
            a.create = withTenantData(a.create ?? {}, tenantId, model);
          } else {
            throw new TenantScopeError(`${model}.${operation} is not supported on a tenant client`);
          }
          return query(a);
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof forTenant>;
export type TenantTx = Parameters<Parameters<TenantClient["$transaction"]>[0]>[0];

export { Prisma };
