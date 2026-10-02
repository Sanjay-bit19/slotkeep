import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createBooking, prisma } from "@slotkeep/db";
import { logger } from "@slotkeep/infra";

const session = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; name: string | null },
}));
vi.mock("@/lib/session", () => ({ getSessionUser: async () => session.user }));

import { AuthzError, can, requireTenant } from "@/lib/authz";
import { createService, createStaff, updateService } from "@/lib/services/catalog";
import { cancelAsOwner, markOutcome } from "@/lib/services/manage-bookings";
import { addMember, removeMember } from "@/lib/services/tenants";
import { usageFor } from "@/lib/services/billing";
import { analyticsFor, bookingDetail, listBookings } from "@/lib/data";
import {
  createTenantFixture,
  customer,
  resetDb,
  type TenantFixture,
} from "../../../../packages/db/test/fixtures";
import { closeQueues, flushRedis } from "./helpers";

const nextYear = new Date().getUTCFullYear() + 1;
const SLOT = new Date(`${nextYear}-06-15T13:00:00.000Z`);

let a: TenantFixture;
let b: TenantFixture;
let bBookingId: string;

async function signInAs(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  session.user = { id: u.id, email: u.email, name: u.name };
}

beforeEach(async () => {
  await resetDb();
  await flushRedis();
  a = await createTenantFixture();
  b = await createTenantFixture();
  bBookingId = (
    await createBooking({
      tenantId: b.tenant.id,
      serviceId: b.serviceId,
      start: SLOT,
      customer: customer(1),
      now: new Date(),
    })
  ).id;
  session.user = null;
});
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

describe("authorization layer", () => {
  it("requires a session", async () => {
    await expect(requireTenant(a.tenant.slug, "booking:read")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("hides other tenants entirely (NOT_FOUND, not FORBIDDEN)", async () => {
    await signInAs(a.ownerId);
    await expect(requireTenant(b.tenant.slug, "booking:read")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(requireTenant("does-not-exist", "booking:read")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("enforces the role matrix for STAFF members", async () => {
    const staffUser = await prisma.user.create({ data: { email: "staff@a.test" } });
    await prisma.membership.create({
      data: { tenantId: a.tenant.id, userId: staffUser.id, role: "STAFF" },
    });
    await signInAs(staffUser.id);
    await expect(requireTenant(a.tenant.slug, "booking:read")).resolves.toMatchObject({
      role: "STAFF",
    });
    await expect(requireTenant(a.tenant.slug, "booking:outcome")).resolves.toBeTruthy();
    for (const p of [
      "booking:cancel",
      "catalog:manage",
      "staff:manage",
      "settings:manage",
      "billing:manage",
      "analytics:read",
      "members:manage",
    ] as const) {
      await expect(requireTenant(a.tenant.slug, p)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(can("STAFF", "booking:cancel")).toBe(false);
    expect(can("OWNER", "booking:cancel")).toBe(true);
  });
});

describe("tenant isolation through the application layer", () => {
  it("an owner of A cannot read, cancel, or modify B's bookings through A's context", async () => {
    await signInAs(a.ownerId);
    const ctx = await requireTenant(a.tenant.slug, "booking:cancel");
    expect(await bookingDetail(ctx, bBookingId)).toBeNull();
    expect((await listBookings(ctx, {})).total).toBe(0);
    await expect(cancelAsOwner(ctx, bBookingId, logger, {})).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(markOutcome(ctx, bBookingId, "COMPLETED")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bBookingId } })).status).toBe(
      "PENDING_PAYMENT",
    );
  });

  it("cannot edit another tenant's service or staff, and cannot link their services", async () => {
    await signInAs(a.ownerId);
    const ctx = await requireTenant(a.tenant.slug, "catalog:manage");
    const svc = {
      name: "Hijack",
      durationMin: 30,
      bufferMin: 0,
      priceCents: 100,
      depositCents: 0,
      active: true,
    };
    await expect(updateService(ctx, b.serviceId, svc)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await prisma.service.findUniqueOrThrow({ where: { id: b.serviceId } })).name).toBe(
      "Haircut",
    );
    const created = await createService(ctx, svc);
    expect(created.tenantId).toBe(a.tenant.id);
    await prisma.tenant.update({
      where: { id: a.tenant.id },
      data: { plan: "PRO", subscriptionStatus: "ACTIVE" },
    });
    const staff = await createStaff(await requireTenant(a.tenant.slug, "staff:manage"), {
      name: "New Person",
      serviceIds: [b.serviceId, created.id],
    });
    const links = await prisma.staffService.findMany({ where: { staffId: staff.id } });
    expect(links.map((l) => l.serviceId)).toEqual([created.id]);
  });

  it("cannot remove members of another tenant", async () => {
    await signInAs(a.ownerId);
    const ctx = await requireTenant(a.tenant.slug, "members:manage");
    const bMembership = await prisma.membership.findFirstOrThrow({
      where: { tenantId: b.tenant.id },
    });
    await expect(removeMember(ctx, bMembership.id)).rejects.toBeInstanceOf(AuthzError);
    expect(await prisma.membership.count({ where: { tenantId: b.tenant.id } })).toBe(1);
  });

  it("analytics and usage only count own data", async () => {
    await signInAs(a.ownerId);
    const ctx = await requireTenant(a.tenant.slug, "analytics:read");
    const analytics = await analyticsFor(ctx);
    expect(analytics.totalBookings).toBe(0);
    expect((await usageFor(ctx)).monthBookings).toBe(0);
  });

  it("members guard: last owner can't be removed, duplicates rejected", async () => {
    await signInAs(a.ownerId);
    const ctx = await requireTenant(a.tenant.slug, "members:manage");
    await addMember(ctx, { email: "new@a.test", role: "OWNER" });
    await expect(addMember(ctx, { email: "new@a.test", role: "STAFF" })).rejects.toMatchObject({
      code: "ALREADY_MEMBER",
    });
    const self = await prisma.membership.findFirstOrThrow({
      where: { tenantId: a.tenant.id, userId: a.ownerId },
    });
    await expect(removeMember(ctx, self.id)).rejects.toMatchObject({ code: "SELF_REMOVE" });
  });
});
