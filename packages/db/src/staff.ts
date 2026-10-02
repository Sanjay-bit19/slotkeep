import { checkStaffLimit, effectivePlan, type StaffInput } from "@slotkeep/core";
import type { Prisma, StaffMember } from "@prisma/client";
import { prisma } from "./client";
import { NotFoundError, PlanLimitError } from "./errors";

type Tx = Prisma.TransactionClient;

async function assertStaffCapacity(tx: Tx, tenantId: string, now: Date, excludeStaffId?: string) {
  // Serialize staff activations per tenant so two concurrent adds can't both pass the limit.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`staff:${tenantId}`}))`;
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const plan = effectivePlan(tenant, now);
  const active = await tx.staffMember.count({
    where: { tenantId, active: true, ...(excludeStaffId ? { id: { not: excludeStaffId } } : {}) },
  });
  const res = checkStaffLimit(plan, active);
  if (!res.ok) {
    throw new PlanLimitError(
      "STAFF_LIMIT",
      `Your plan allows ${res.limit} active staff member${res.limit === 1 ? "" : "s"}. Upgrade to add more.`,
    );
  }
}

async function writeStaffRelations(tx: Tx, tenantId: string, staffId: string, input: StaffInput) {
  await tx.weeklyAvailability.deleteMany({ where: { tenantId, staffId } });
  if (input.weekly.length) {
    await tx.weeklyAvailability.createMany({
      data: input.weekly.map((w) => ({ tenantId, staffId, ...w })),
    });
  }
  await tx.staffService.deleteMany({ where: { tenantId, staffId } });
  if (input.serviceIds.length) {
    // Only link services that belong to this tenant (composite FK enforces it too).
    const services = await tx.service.findMany({
      where: { tenantId, id: { in: input.serviceIds } },
      select: { id: true },
    });
    await tx.staffService.createMany({
      data: services.map((s) => ({ tenantId, staffId, serviceId: s.id })),
    });
  }
}

export async function createStaffMember(tenantId: string, input: StaffInput, now = new Date()): Promise<StaffMember> {
  return prisma.$transaction(async (tx) => {
    if (input.active) await assertStaffCapacity(tx, tenantId, now);
    const staff = await tx.staffMember.create({
      data: { tenantId, name: input.name, email: input.email || null, active: input.active },
    });
    await writeStaffRelations(tx, tenantId, staff.id, input);
    return staff;
  });
}

export async function updateStaffMember(
  tenantId: string,
  staffId: string,
  input: StaffInput,
  now = new Date(),
): Promise<StaffMember> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.staffMember.findFirst({ where: { id: staffId, tenantId } });
    if (!existing) throw new NotFoundError("Staff member");
    if (input.active && !existing.active) await assertStaffCapacity(tx, tenantId, now, staffId);
    const staff = await tx.staffMember.update({
      where: { id: staffId },
      data: { name: input.name, email: input.email || null, active: input.active },
    });
    await writeStaffRelations(tx, tenantId, staffId, input);
    return staff;
  });
}
