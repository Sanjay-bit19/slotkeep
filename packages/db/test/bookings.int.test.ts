import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyDepositPaid,
  cancelBooking,
  countMonthlyBookings,
  createBooking,
  expireHold,
  expireOverdueHolds,
  recordRefund,
  rescheduleBooking,
  setBookingOutcome,
} from "../src/bookings";
import { getAvailableSlots } from "../src/availability";
import { prisma } from "../src/client";
import { InvalidStateError, PlanLimitError, SlotUnavailableError } from "../src/errors";
import { createStaffMember, updateStaffMember } from "../src/staff";
import { NOW, SLOT, createTenantFixture, customer, resetDb } from "./fixtures";

const min = (n: number) => n * 60_000;

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("double-booking prevention", () => {
  it("20 simultaneous requests for the same slot: exactly one succeeds", async () => {
    const fx = await createTenantFixture();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        createBooking({
          tenantId: fx.tenant.id,
          serviceId: fx.serviceId,
          start: SLOT,
          customer: customer(i),
          now: NOW,
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(19);
    for (const f of failed) expect(f.reason).toBeInstanceOf(SlotUnavailableError);
    expect(
      await prisma.booking.count({
        where: { tenantId: fx.tenant.id, status: { not: "CANCELLED" } },
      }),
    ).toBe(1);
  });

  it("with 'any staff' and 3 staff, 20 simultaneous requests yield exactly 3 bookings on distinct staff", async () => {
    const fx = await createTenantFixture({ staffCount: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        createBooking({
          tenantId: fx.tenant.id,
          serviceId: fx.serviceId,
          start: SLOT,
          customer: customer(i),
          now: NOW,
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
      staffId: string;
    }>[];
    expect(ok).toHaveLength(3);
    expect(new Set(ok.map((r) => r.value.staffId)).size).toBe(3);
  });

  it("the constraint also rejects overlaps that bypass the application layer", async () => {
    const fx = await createTenantFixture();
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    const raw = {
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      staffId: b.staffId,
      customerId: b.customerId,
      status: "CONFIRMED" as const,
      priceCents: 1,
      depositCents: 0,
    };
    // Starts inside the first booking's buffer (10:00-11:00 + 15 min => blocked until 11:15).
    await expect(
      prisma.booking.create({
        data: {
          ...raw,
          startAt: new Date(SLOT.getTime() + min(70)),
          endAt: new Date(SLOT.getTime() + min(100)),
          blockedUntil: new Date(SLOT.getTime() + min(100)),
        },
      }),
    ).rejects.toThrow(/booking_no_overlap|23P01/);
    // Touching the end of the buffer is fine.
    await expect(
      prisma.booking.create({
        data: {
          ...raw,
          startAt: new Date(SLOT.getTime() + min(75)),
          endAt: new Date(SLOT.getTime() + min(105)),
          blockedUntil: new Date(SLOT.getTime() + min(105)),
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("cancelled bookings free the slot", async () => {
    const fx = await createTenantFixture({ depositCents: 0 });
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(1),
      now: NOW,
    });
    await cancelBooking({ tenantId: fx.tenant.id, bookingId: b.id, by: "OWNER", now: NOW });
    const again = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(2),
      now: NOW,
    });
    expect(again.status).toBe("CONFIRMED");
  });

  it("rejects starts outside availability or misaligned", async () => {
    const fx = await createTenantFixture();
    await expect(
      createBooking({
        tenantId: fx.tenant.id,
        serviceId: fx.serviceId,
        start: new Date("2030-03-04T03:00:00Z"),
        customer: customer(),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
    await expect(
      createBooking({
        tenantId: fx.tenant.id,
        serviceId: fx.serviceId,
        start: new Date(SLOT.getTime() + min(7)),
        customer: customer(),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });
});

describe("slot holds", () => {
  it("creates a 10 minute hold for services with a deposit and blocks the slot", async () => {
    const fx = await createTenantFixture();
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    expect(b.status).toBe("PENDING_PAYMENT");
    expect(b.holdExpiresAt!.getTime() - NOW.getTime()).toBe(min(10));
    const slots = await getAvailableSlots({
      tenant: fx.tenant,
      serviceId: fx.serviceId,
      fromDate: "2030-03-04",
      toDate: "2030-03-04",
      now: NOW,
    });
    expect(slots!.some((s) => s.start.getTime() === SLOT.getTime())).toBe(false);
  });

  it("confirms immediately when the service has no deposit", async () => {
    const fx = await createTenantFixture({ depositCents: 0 });
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    expect(b.status).toBe("CONFIRMED");
    expect(b.holdExpiresAt).toBeNull();
  });

  it("expireHold is a no-op before expiry and releases after", async () => {
    const fx = await createTenantFixture();
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    expect((await expireHold(b.id, new Date(NOW.getTime() + min(9)))).expired).toBe(false);
    const res = await expireHold(b.id, new Date(NOW.getTime() + min(10)));
    expect(res.expired).toBe(true);
    expect(res.booking).toMatchObject({ status: "CANCELLED", cancelReason: "HOLD_EXPIRED" });
    expect((await expireHold(b.id, new Date(NOW.getTime() + min(11)))).expired).toBe(false);
  });

  it("an overdue hold does not block availability or a new booking even if the job never ran", async () => {
    const fx = await createTenantFixture();
    const held = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(1),
      now: NOW,
    });
    const later = new Date(NOW.getTime() + min(11));
    const slots = await getAvailableSlots({
      tenant: fx.tenant,
      serviceId: fx.serviceId,
      fromDate: "2030-03-04",
      toDate: "2030-03-04",
      now: later,
    });
    expect(slots!.some((s) => s.start.getTime() === SLOT.getTime())).toBe(true);
    const b2 = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(2),
      now: later,
    });
    expect(b2.status).toBe("PENDING_PAYMENT");
    expect(await prisma.booking.findUnique({ where: { id: held.id } })).toMatchObject({
      status: "CANCELLED",
      cancelReason: "HOLD_EXPIRED",
    });
  });

  it("the sweeper releases overdue holds", async () => {
    const fx = await createTenantFixture();
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    expect(await expireOverdueHolds(NOW)).toEqual([]);
    expect(await expireOverdueHolds(new Date(NOW.getTime() + min(10)))).toEqual([b.id]);
  });
});

describe("deposit payment (webhook effects)", () => {
  async function held() {
    const fx = await createTenantFixture();
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(1),
      now: NOW,
    });
    return { fx, b };
  }
  const pay = (bookingId: string, now = NOW) =>
    prisma.$transaction((tx) =>
      applyDepositPaid(tx, { bookingId, paymentIntentId: "pi_1", amountCents: 1000, now }),
    );

  it("confirms a pending hold", async () => {
    const { b } = await held();
    const res = await pay(b.id);
    expect(res.outcome).toBe("CONFIRMED");
    expect(res.booking).toMatchObject({
      status: "CONFIRMED",
      depositPaidCents: 1000,
      holdExpiresAt: null,
    });
    expect((await pay(b.id)).outcome).toBe("ALREADY_CONFIRMED");
  });

  it("reinstates a late payment if the slot is still free", async () => {
    const { b } = await held();
    await expireHold(b.id, new Date(NOW.getTime() + min(10)));
    const res = await pay(b.id, new Date(NOW.getTime() + min(12)));
    expect(res.outcome).toBe("REINSTATED");
    expect(res.booking).toMatchObject({ status: "CONFIRMED", cancelReason: null });
  });

  it("reports a conflict on a late payment when someone else took the slot", async () => {
    const { fx, b } = await held();
    const later = new Date(NOW.getTime() + min(11));
    await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(2),
      now: later,
    });
    const res = await pay(b.id, later);
    expect(res.outcome).toBe("CONFLICT");
    expect(res.booking).toMatchObject({
      status: "CANCELLED",
      cancelReason: "PAYMENT_CONFLICT",
      depositPaidCents: 1000,
    });
  });

  it("returns NOT_FOUND for unknown bookings", async () => {
    expect((await pay("nope")).outcome).toBe("NOT_FOUND");
  });
});

describe("cancel, refund, reschedule, outcomes", () => {
  async function confirmed(opts: Parameters<typeof createTenantFixture>[0] = {}) {
    const fx = await createTenantFixture(opts);
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(1),
      now: NOW,
    });
    await prisma.$transaction((tx) =>
      applyDepositPaid(tx, {
        bookingId: b.id,
        paymentIntentId: "pi_1",
        amountCents: 1000,
        now: NOW,
      }),
    );
    return { fx, b };
  }

  it("owner cancel refunds the full deposit and bumps the token version", async () => {
    const { fx, b } = await confirmed();
    const res = await cancelBooking({
      tenantId: fx.tenant.id,
      bookingId: b.id,
      by: "OWNER",
      now: NOW,
    });
    expect(res.refundCents).toBe(1000);
    expect(res.booking.status).toBe("CANCELLED");
    expect(res.booking.tokenVersion).toBe(b.tokenVersion + 1);
    expect(await recordRefund(b.id, "re_1", 1000)).toBe(true);
    expect(await recordRefund(b.id, "re_1", 1000)).toBe(false); // idempotent replay
    expect(await prisma.booking.findUnique({ where: { id: b.id } })).toMatchObject({
      refundedCents: 1000,
      stripeRefundId: "re_1",
    });
  });

  it("customer cancel inside the window keeps the deposit; outside refunds it", async () => {
    const inside = await confirmed();
    const late = new Date(SLOT.getTime() - 3_600_000);
    expect(
      (
        await cancelBooking({
          tenantId: inside.fx.tenant.id,
          bookingId: inside.b.id,
          by: "CUSTOMER",
          now: late,
        })
      ).refundCents,
    ).toBe(0);
    await resetDb();
    const outside = await confirmed();
    expect(
      (
        await cancelBooking({
          tenantId: outside.fx.tenant.id,
          bookingId: outside.b.id,
          by: "CUSTOMER",
          now: NOW,
        })
      ).refundCents,
    ).toBe(1000);
  });

  it("rejects stale customer links and double cancellation", async () => {
    const { fx, b } = await confirmed();
    await expect(
      cancelBooking({
        tenantId: fx.tenant.id,
        bookingId: b.id,
        by: "CUSTOMER",
        now: NOW,
        expectedTokenVersion: b.tokenVersion + 5,
      }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await cancelBooking({ tenantId: fx.tenant.id, bookingId: b.id, by: "OWNER", now: NOW });
    await expect(
      cancelBooking({ tenantId: fx.tenant.id, bookingId: b.id, by: "OWNER", now: NOW }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("reschedules to a free slot, refuses a taken one, and frees the old slot", async () => {
    const { fx, b } = await confirmed({ depositCents: 1000 });
    const other = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: new Date(SLOT.getTime() + min(180)),
      customer: customer(2),
      now: NOW,
    });
    await expect(
      rescheduleBooking({
        tenantId: fx.tenant.id,
        bookingId: b.id,
        newStart: other.startAt,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
    // Overlapping its own current slot is fine (it doesn't block itself).
    const moved = await rescheduleBooking({
      tenantId: fx.tenant.id,
      bookingId: b.id,
      newStart: new Date(SLOT.getTime() + min(30)),
      now: NOW,
    });
    expect(moved.startAt).toEqual(new Date(SLOT.getTime() + min(30)));
    expect(moved.endAt.getTime() - moved.startAt.getTime()).toBe(min(60));
    expect(moved.blockedUntil.getTime() - moved.endAt.getTime()).toBe(min(15));
    expect(moved.tokenVersion).toBe(b.tokenVersion + 1);
  });

  it("refuses to reschedule inside the cancellation window", async () => {
    const { fx, b } = await confirmed();
    await expect(
      rescheduleBooking({
        tenantId: fx.tenant.id,
        bookingId: b.id,
        newStart: new Date(SLOT.getTime() + min(120)),
        now: new Date(SLOT.getTime() - 3_600_000),
      }),
    ).rejects.toThrow(/too late/);
  });

  it("records outcomes only after the start time and only from valid states", async () => {
    const { fx, b } = await confirmed();
    await expect(
      setBookingOutcome({ tenantId: fx.tenant.id, bookingId: b.id, status: "COMPLETED", now: NOW }),
    ).rejects.toThrow(/after the appointment/);
    const after = new Date(SLOT.getTime() + min(61));
    expect(
      (
        await setBookingOutcome({
          tenantId: fx.tenant.id,
          bookingId: b.id,
          status: "NO_SHOW",
          now: after,
        })
      ).status,
    ).toBe("NO_SHOW");
    expect(
      (
        await setBookingOutcome({
          tenantId: fx.tenant.id,
          bookingId: b.id,
          status: "COMPLETED",
          now: after,
        })
      ).status,
    ).toBe("COMPLETED");
  });
});

describe("plan limits (server-side)", () => {
  it("free plan blocks the 51st booking of the month", async () => {
    const fx = await createTenantFixture({ plan: "FREE", depositCents: 0 });
    // 50 bookings created earlier this month at distinct times (inserted directly for speed).
    const c = await prisma.customer.create({
      data: { tenantId: fx.tenant.id, name: "x", email: "x@example.com" },
    });
    await prisma.booking.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        tenantId: fx.tenant.id,
        serviceId: fx.serviceId,
        staffId: fx.staffIds[0]!,
        customerId: c.id,
        startAt: new Date(Date.UTC(2030, 5, 1, 0, 0) + i * min(120)),
        endAt: new Date(Date.UTC(2030, 5, 1, 1, 0) + i * min(120)),
        blockedUntil: new Date(Date.UTC(2030, 5, 1, 1, 0) + i * min(120)),
        status: "CONFIRMED" as const,
        priceCents: 5000,
        depositCents: 0,
        createdAt: NOW,
        confirmedAt: NOW,
      })),
    });
    expect(await countMonthlyBookings(prisma, fx.tenant.id, fx.tenant.timezone, NOW)).toBe(50);
    await expect(
      createBooking({
        tenantId: fx.tenant.id,
        serviceId: fx.serviceId,
        start: SLOT,
        customer: customer(),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("free plan quota holds under concurrency (49 used, 5 concurrent requests at different times => 1 succeeds)", async () => {
    const fx = await createTenantFixture({ plan: "FREE", depositCents: 0 });
    const c = await prisma.customer.create({
      data: { tenantId: fx.tenant.id, name: "x", email: "x@example.com" },
    });
    await prisma.booking.createMany({
      data: Array.from({ length: 49 }, (_, i) => ({
        tenantId: fx.tenant.id,
        serviceId: fx.serviceId,
        staffId: fx.staffIds[0]!,
        customerId: c.id,
        startAt: new Date(Date.UTC(2030, 5, 1) + i * min(120)),
        endAt: new Date(Date.UTC(2030, 5, 1) + i * min(120) + min(60)),
        blockedUntil: new Date(Date.UTC(2030, 5, 1) + i * min(120) + min(60)),
        status: "CONFIRMED" as const,
        priceCents: 5000,
        depositCents: 0,
        createdAt: NOW,
        confirmedAt: NOW,
      })),
    });
    const results = await Promise.allSettled(
      [0, 1, 2, 3, 4].map((i) =>
        createBooking({
          tenantId: fx.tenant.id,
          serviceId: fx.serviceId,
          start: new Date(SLOT.getTime() + i * min(75)),
          customer: customer(i),
          now: NOW,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const r of rejected) expect(r.reason).toBeInstanceOf(PlanLimitError);
  });

  it("expired unpaid holds do not count against the quota", async () => {
    const fx = await createTenantFixture({ plan: "FREE" });
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    expect(await countMonthlyBookings(prisma, fx.tenant.id, fx.tenant.timezone, NOW)).toBe(1);
    await expireHold(b.id, new Date(NOW.getTime() + min(10)));
    expect(await countMonthlyBookings(prisma, fx.tenant.id, fx.tenant.timezone, NOW)).toBe(0);
  });

  it("free plan allows one active staff member", async () => {
    const fx = await createTenantFixture({ plan: "FREE", staffCount: 1 });
    const input = { name: "Second", email: "", active: true, serviceIds: [], weekly: [] };
    await expect(createStaffMember(fx.tenant.id, input)).rejects.toBeInstanceOf(PlanLimitError);
    const inactive = await createStaffMember(fx.tenant.id, { ...input, active: false });
    await expect(updateStaffMember(fx.tenant.id, inactive.id, input)).rejects.toBeInstanceOf(
      PlanLimitError,
    );
  });

  it("pro plan has no staff cap and a cancelled-but-paid-up subscription keeps it", async () => {
    const fx = await createTenantFixture({ plan: "PRO", staffCount: 1 });
    await prisma.tenant.update({
      where: { id: fx.tenant.id },
      data: { subscriptionStatus: "CANCELED", currentPeriodEnd: new Date(Date.now() + 86_400_000) },
    });
    const s = await createStaffMember(fx.tenant.id, {
      name: "Second",
      email: "",
      active: true,
      serviceIds: [fx.serviceId],
      weekly: [{ weekday: 1, startMinute: 540, endMinute: 600 }],
    });
    expect(await prisma.weeklyAvailability.count({ where: { staffId: s.id } })).toBe(1);
    expect(await prisma.staffService.count({ where: { staffId: s.id } })).toBe(1);
  });
});
