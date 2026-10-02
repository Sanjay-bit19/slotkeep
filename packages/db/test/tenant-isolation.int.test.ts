import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBooking, cancelBooking, rescheduleBooking, setBookingOutcome } from "../src/bookings";
import { prisma } from "../src/client";
import { NotFoundError } from "../src/errors";
import { updateStaffMember } from "../src/staff";
import { forTenant, TenantScopeError } from "../src/tenant";
import { NOW, SLOT, createTenantFixture, customer, resetDb, type TenantFixture } from "./fixtures";

let a: TenantFixture;
let b: TenantFixture;
let bBookingId: string;

beforeEach(async () => {
  await resetDb();
  a = await createTenantFixture();
  b = await createTenantFixture();
  const booking = await createBooking({ tenantId: b.tenant.id, serviceId: b.serviceId, start: SLOT, customer: customer(9), now: NOW });
  bBookingId = booking.id;
});
afterAll(() => prisma.$disconnect());

describe("tenant-scoped client: reads", () => {
  it("cannot read another tenant's rows by id", async () => {
    const db = forTenant(a.tenant.id);
    expect(await db.booking.findUnique({ where: { id: bBookingId } })).toBeNull();
    expect(await db.booking.findFirst({ where: { id: bBookingId } })).toBeNull();
    expect(await db.service.findUnique({ where: { id: b.serviceId } })).toBeNull();
    expect(await db.staffMember.findUnique({ where: { id: b.staffIds[0]! } })).toBeNull();
    await expect(db.booking.findUniqueOrThrow({ where: { id: bBookingId } })).rejects.toThrow();
  });

  it("list and aggregate queries only see own rows, even when asked for another tenant", async () => {
    const db = forTenant(a.tenant.id);
    expect(await db.booking.findMany()).toEqual([]);
    expect(await db.booking.count()).toBe(0);
    expect(await db.customer.findMany({ where: { tenantId: b.tenant.id } })).toEqual([]);
    expect(await db.booking.findMany({ where: { OR: [{ tenantId: b.tenant.id }, { id: bBookingId }] } })).toEqual([]);
    const agg = await db.booking.aggregate({ _sum: { priceCents: true } });
    expect(agg._sum.priceCents).toBeNull();
  });

  it("includes through relations never cross tenants", async () => {
    const services = await forTenant(a.tenant.id).service.findMany({ include: { bookings: true, staff: true } });
    expect(services).toHaveLength(1);
    expect(services[0]!.bookings).toEqual([]);
    expect(services[0]!.staff.every((s) => s.tenantId === a.tenant.id)).toBe(true);
  });
});

describe("tenant-scoped client: writes", () => {
  it("cannot update or delete another tenant's rows", async () => {
    const db = forTenant(a.tenant.id);
    await expect(db.booking.update({ where: { id: bBookingId }, data: { notes: "pwned" } })).rejects.toThrow();
    expect((await db.booking.updateMany({ where: { id: bBookingId }, data: { notes: "pwned" } })).count).toBe(0);
    await expect(db.service.delete({ where: { id: b.serviceId } })).rejects.toThrow();
    expect((await db.service.deleteMany({ where: { id: b.serviceId } })).count).toBe(0);
    expect((await prisma.booking.findUnique({ where: { id: bBookingId } }))!.notes).toBe("");
    expect(await prisma.service.findUnique({ where: { id: b.serviceId } })).not.toBeNull();
  });

  it("cannot create rows in another tenant", async () => {
    const db = forTenant(a.tenant.id);
    await expect(
      db.service.create({ data: { tenantId: b.tenant.id, name: "x", durationMin: 30, priceCents: 0, depositCents: 0 } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      db.service.createMany({ data: [{ tenantId: b.tenant.id, name: "x", durationMin: 30, priceCents: 0, depositCents: 0 }] }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      db.service.create({ data: { tenant: { connect: { id: b.tenant.id } }, name: "x", durationMin: 30, priceCents: 0, depositCents: 0 } as never }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("creates without tenantId are stamped with the scoped tenant", async () => {
    const svc = await forTenant(a.tenant.id).service.create({
      data: { name: "Stamped", durationMin: 30, priceCents: 0, depositCents: 0 } as never,
    });
    expect(svc.tenantId).toBe(a.tenant.id);
  });

  it("composite foreign keys stop cross-tenant references", async () => {
    const db = forTenant(a.tenant.id);
    // Link A's staff to B's service.
    await expect(db.staffService.create({ data: { staffId: a.staffIds[0]!, serviceId: b.serviceId } as never })).rejects.toThrow();
    // Give B's staff member hours from A's context.
    await expect(
      db.weeklyAvailability.create({ data: { staffId: b.staffIds[0]!, weekday: 1, startMinute: 0, endMinute: 60 } as never }),
    ).rejects.toThrow();
    // Book B's staff for A's service directly, even with the base client.
    const c = await prisma.customer.create({ data: { tenantId: a.tenant.id, name: "c", email: "c@a.co" } });
    await expect(
      prisma.booking.create({
        data: {
          tenantId: a.tenant.id, serviceId: a.serviceId, staffId: b.staffIds[0]!, customerId: c.id,
          // A time B's staff member is free, so only the foreign key can reject it.
          startAt: new Date(SLOT.getTime() + 86_400_000), endAt: new Date(SLOT.getTime() + 90_000_000), blockedUntil: new Date(SLOT.getTime() + 90_000_000),
          status: "CONFIRMED", priceCents: 0, depositCents: 0,
        },
      }),
    ).rejects.toThrow(/Foreign key/);
  });

  it("upsert cannot hijack another tenant's row", async () => {
    const db = forTenant(a.tenant.id);
    const bCustomer = await prisma.customer.findFirstOrThrow({ where: { tenantId: b.tenant.id } });
    const res = await db.customer.upsert({
      where: { id: bCustomer.id },
      update: { name: "hijacked" },
      create: { name: "new", email: "new@a.co" } as never,
    });
    expect(res.tenantId).toBe(a.tenant.id);
    expect((await prisma.customer.findUnique({ where: { id: bCustomer.id } }))!.name).not.toBe("hijacked");
  });
});

describe("domain operations are tenant-bound", () => {
  it("booking operations with the wrong tenant fail as not found", async () => {
    await expect(cancelBooking({ tenantId: a.tenant.id, bookingId: bBookingId, by: "OWNER", now: NOW })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setBookingOutcome({ tenantId: a.tenant.id, bookingId: bBookingId, status: "COMPLETED", now: NOW })).rejects.toBeInstanceOf(NotFoundError);
    await expect(rescheduleBooking({ tenantId: a.tenant.id, bookingId: bBookingId, newStart: SLOT, now: NOW })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateStaffMember(a.tenant.id, b.staffIds[0]!, { name: "x y", email: "", active: true, serviceIds: [], weekly: [] })).rejects.toBeInstanceOf(NotFoundError);
    expect((await prisma.booking.findUnique({ where: { id: bBookingId } }))!.status).toBe("PENDING_PAYMENT");
  });

  it("cannot book another tenant's service through your tenant", async () => {
    await expect(
      createBooking({ tenantId: a.tenant.id, serviceId: b.serviceId, start: SLOT, customer: customer(), now: NOW }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("staff updates cannot link another tenant's services", async () => {
    await updateStaffMember(a.tenant.id, a.staffIds[0]!, { name: "Ana B", email: "", active: true, serviceIds: [a.serviceId, b.serviceId], weekly: [] });
    const links = await prisma.staffService.findMany({ where: { staffId: a.staffIds[0]! } });
    expect(links.map((l) => l.serviceId)).toEqual([a.serviceId]);
  });

  it("rejects an empty tenant id", () => {
    expect(() => forTenant("")).toThrow(TenantScopeError);
  });
});
