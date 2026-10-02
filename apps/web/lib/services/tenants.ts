import { memberInviteSchema, onboardingSchema, tenantSettingsSchema } from "@slotkeep/core";
import { DomainError, isUniqueViolation, prisma } from "@slotkeep/db";
import type { SessionUser } from "../session";
import { AuthzError, type TenantContext } from "../authz";

/**
 * Onboarding: creates the business, makes the user its OWNER, and seeds a staff profile for the
 * owner (Mon-Fri 9-5) so the first service is bookable as soon as it exists.
 */
export async function createTenantForUser(user: SessionUser, raw: unknown) {
  const input = onboardingSchema.parse(raw);
  try {
    return await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.name,
          slug: input.slug,
          timezone: input.timezone,
          brandColor: input.brandColor,
        },
      });
      await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: "OWNER" } });
      const staff = await tx.staffMember.create({
        data: {
          tenantId: tenant.id,
          name: user.name || user.email.split("@")[0]!,
          email: user.email,
        },
      });
      await tx.weeklyAvailability.createMany({
        data: [1, 2, 3, 4, 5].map((weekday) => ({
          tenantId: tenant.id,
          staffId: staff.id,
          weekday,
          startMinute: 9 * 60,
          endMinute: 17 * 60,
        })),
      });
      return tenant;
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new DomainError("SLUG_TAKEN", "That booking page address is taken", 409);
    throw err;
  }
}

export async function updateTenantSettings(ctx: TenantContext, raw: unknown) {
  const input = tenantSettingsSchema.parse(raw);
  return prisma.tenant.update({ where: { id: ctx.tenant.id }, data: input });
}

export async function listMembers(ctx: TenantContext) {
  return ctx.db.membership.findMany({
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Adds a member by email. If they have never signed in, a User row is created so their first
 * magic-link login lands straight in this workspace.
 */
export async function addMember(ctx: TenantContext, raw: unknown) {
  const input = memberInviteSchema.parse(raw);
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {},
    create: { email: input.email },
  });
  try {
    return await ctx.db.membership.create({ data: { userId: user.id, role: input.role } as never });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new DomainError("ALREADY_MEMBER", "That person is already a member", 409);
    throw err;
  }
}

export async function removeMember(ctx: TenantContext, membershipId: string) {
  const m = await ctx.db.membership.findUnique({ where: { id: membershipId } });
  if (!m) throw new AuthzError("NOT_FOUND");
  if (m.userId === ctx.user.id)
    throw new DomainError("SELF_REMOVE", "You can't remove yourself", 400);
  if (m.role === "OWNER") {
    const owners = await ctx.db.membership.count({ where: { role: "OWNER" } });
    if (owners <= 1)
      throw new DomainError("LAST_OWNER", "A business needs at least one owner", 400);
  }
  await ctx.db.membership.delete({ where: { id: membershipId } });
}
