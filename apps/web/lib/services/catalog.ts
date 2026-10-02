import { serviceSchema, staffSchema, timeOffSchema } from "@slotkeep/core";
import { createStaffMember, NotFoundError, updateStaffMember } from "@slotkeep/db";
import type { TenantContext } from "../authz";

export async function createService(ctx: TenantContext, raw: unknown) {
  const input = serviceSchema.parse(raw);
  const service = await ctx.db.service.create({ data: input as never });
  // Convenience: on a single-staff business, the new service is offered by that person.
  const staff = await ctx.db.staffMember.findMany({
    where: { active: true },
    select: { id: true },
  });
  if (staff.length === 1) {
    await ctx.db.staffService.create({
      data: { staffId: staff[0]!.id, serviceId: service.id } as never,
    });
  }
  return service;
}

export async function updateService(ctx: TenantContext, serviceId: string, raw: unknown) {
  const input = serviceSchema.parse(raw);
  const res = await ctx.db.service.updateMany({ where: { id: serviceId }, data: input });
  if (res.count !== 1) throw new NotFoundError("Service");
}

export async function createStaff(ctx: TenantContext, raw: unknown) {
  return createStaffMember(ctx.tenant.id, staffSchema.parse(raw));
}

export async function updateStaff(ctx: TenantContext, staffId: string, raw: unknown) {
  return updateStaffMember(ctx.tenant.id, staffId, staffSchema.parse(raw));
}

export async function addTimeOff(ctx: TenantContext, raw: unknown) {
  const input = timeOffSchema.parse(raw);
  const staff = await ctx.db.staffMember.findUnique({ where: { id: input.staffId } });
  if (!staff) throw new NotFoundError("Staff member");
  return ctx.db.timeOff.create({
    data: {
      staffId: input.staffId,
      startAt: input.startAt,
      endAt: input.endAt,
      reason: input.reason || null,
    } as never,
  });
}

export async function deleteTimeOff(ctx: TenantContext, timeOffId: string) {
  const res = await ctx.db.timeOff.deleteMany({ where: { id: timeOffId } });
  if (res.count !== 1) throw new NotFoundError("Time off");
}
