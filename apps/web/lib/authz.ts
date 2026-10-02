import { effectivePlan, type Plan } from "@slotkeep/core";
import { forTenant, prisma, type Role, type Tenant, type TenantClient } from "@slotkeep/db";
import { getSessionUser, type SessionUser } from "./session";

/**
 * The single authorization layer. Every server action, route handler and page that touches
 * tenant data goes through `requireTenant(slug, permission)`, which:
 *   1. requires a signed-in user,
 *   2. requires a membership in the tenant (non-members get NOT_FOUND, so slugs don't leak),
 *   3. checks the member's role against the permission matrix below,
 *   4. hands back a tenant-scoped database client, so the handler can't query other tenants.
 * Components never make authorization decisions; at most they hide buttons using `can()`.
 */

export const PERMISSIONS = {
  "booking:read": ["OWNER", "STAFF"],
  "booking:outcome": ["OWNER", "STAFF"],
  "booking:cancel": ["OWNER"],
  "catalog:manage": ["OWNER"],
  "staff:manage": ["OWNER"],
  "settings:manage": ["OWNER"],
  "members:manage": ["OWNER"],
  "billing:manage": ["OWNER"],
  "analytics:read": ["OWNER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export type AuthzErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND";

export class AuthzError extends Error {
  constructor(
    public readonly code: AuthzErrorCode,
    message?: string,
  ) {
    super(
      message ??
        (code === "UNAUTHENTICATED"
          ? "Please sign in"
          : code === "FORBIDDEN"
            ? "You don't have permission to do that"
            : "Not found"),
    );
    this.name = "AuthzError";
  }

  get status(): number {
    return this.code === "UNAUTHENTICATED" ? 401 : this.code === "FORBIDDEN" ? 403 : 404;
  }
}

export interface TenantContext {
  user: SessionUser;
  tenant: Tenant;
  role: Role;
  plan: Plan;
  db: TenantClient;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthzError("UNAUTHENTICATED");
  return user;
}

async function contextFor(
  user: SessionUser,
  where: { slug: string } | { id: string },
  permission: Permission,
) {
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, tenant: where },
    include: { tenant: true },
  });
  if (!membership) throw new AuthzError("NOT_FOUND");
  if (!can(membership.role, permission)) throw new AuthzError("FORBIDDEN");
  return {
    user,
    tenant: membership.tenant,
    role: membership.role,
    plan: effectivePlan(membership.tenant, new Date()),
    db: forTenant(membership.tenant.id),
  } satisfies TenantContext;
}

export async function requireTenant(slug: string, permission: Permission): Promise<TenantContext> {
  return contextFor(await requireUser(), { slug }, permission);
}

export async function requireTenantById(
  tenantId: string,
  permission: Permission,
): Promise<TenantContext> {
  return contextFor(await requireUser(), { id: tenantId }, permission);
}

export async function listMemberships(userId: string) {
  return prisma.membership.findMany({
    where: { userId },
    include: { tenant: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "asc" },
  });
}
