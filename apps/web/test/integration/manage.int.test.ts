import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addDaysToLocalDate, signManageToken, toLocalDate, wallTimeToUtc } from "@slotkeep/core";
import { applyDepositPaid, createBooking, prisma } from "@slotkeep/db";
import { logger, manageUrlFor } from "@slotkeep/infra";
import { GET as manageAvailability } from "@/app/api/manage/[token]/availability/route";
import {
  bookingFromToken,
  cancelAsCustomer,
  rescheduleAsCustomer,
} from "@/lib/services/manage-bookings";
import { createTenantFixture, customer, resetDb } from "../../../../packages/db/test/fixtures";
import { closeQueues, flushRedis, jobIds, QUEUE_NAMES } from "./helpers";

const TZ = "America/New_York";
const DAY = addDaysToLocalDate(toLocalDate(new Date(), TZ), 30);
const at = (h: number, m = 0) => wallTimeToUtc(DAY, h * 60 + m, TZ);

async function confirmedBooking() {
  const fx = await createTenantFixture();
  const b = await createBooking({
    tenantId: fx.tenant.id,
    serviceId: fx.serviceId,
    start: at(10),
    customer: customer(1),
    now: new Date(),
  });
  await prisma.$transaction((tx) =>
    applyDepositPaid(tx, {
      bookingId: b.id,
      paymentIntentId: "pi_x",
      amountCents: 1000,
      now: new Date(),
    }),
  );
  const fresh = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
  const token = decodeURIComponent(manageUrlFor(fresh).split("/m/")[1]!);
  return { fx, b: fresh, token };
}

beforeEach(async () => {
  await resetDb();
  await flushRedis();
});
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

describe("customer self-service links", () => {
  it("rejects forged, expired and foreign-secret tokens", async () => {
    const { b, token } = await confirmedBooking();
    await expect(bookingFromToken(token.slice(0, -2) + "xx")).rejects.toMatchObject({
      code: "INVALID_LINK",
    });
    const expired = signManageToken(
      { bookingId: b.id, version: b.tokenVersion, expiresAt: new Date(Date.now() - 1000) },
      process.env.MANAGE_TOKEN_SECRET!,
    );
    await expect(bookingFromToken(expired)).rejects.toMatchObject({
      code: "INVALID_LINK",
      status: 410,
    });
    const foreign = signManageToken(
      { bookingId: b.id, version: b.tokenVersion, expiresAt: b.startAt },
      "some-other-secret-value",
    );
    await expect(bookingFromToken(foreign)).rejects.toMatchObject({ code: "INVALID_LINK" });
  });

  it("reschedules, emails the customer, and revokes the old link", async () => {
    const { b, token } = await confirmedBooking();
    const moved = await rescheduleAsCustomer(token, at(13), logger, { requestId: "r1" });
    expect(moved.startAt).toEqual(at(13));
    expect(await jobIds(QUEUE_NAMES.email)).toEqual(
      expect.arrayContaining([
        `booking-rescheduled-${b.id}-${moved.tokenVersion}`,
        `booking-reminder-${b.id}-${at(13).getTime()}`,
      ]),
    );
    // The old link still opens (read-only) but can no longer change anything.
    const old = await bookingFromToken(token);
    expect(old.current).toBe(false);
    await expect(cancelAsCustomer(token, logger, {})).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(rescheduleAsCustomer(token, at(14), logger, {})).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("cancels with a full refund outside the window (fake gateway) and records it", async () => {
    const { b, token } = await confirmedBooking();
    const out = await cancelAsCustomer(token, logger, {});
    expect(out).toEqual({ refundCents: 1000, refundStatus: "refunded" });
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after).toMatchObject({
      status: "CANCELLED",
      cancelReason: "CUSTOMER",
      refundedCents: 1000,
    });
    expect(after.stripeRefundId).toMatch(/^re_fake_/);
    expect(await jobIds(QUEUE_NAMES.email)).toContain(`booking-cancelled-${b.id}`);
  });

  it("reschedule availability excludes the booking's own slot from conflicts", async () => {
    const { token } = await confirmedBooking();
    const res = await manageAvailability(
      new Request(`http://localhost/api/manage/${token}/availability?date=${DAY}`),
      { params: Promise.resolve({ token }) },
    );
    const json = await res.json();
    const starts = json.slots.map((s: { start: string }) => s.start);
    // 10:30 overlaps the booking's current 10:00-11:15 footprint but must be offered.
    expect(starts).toContain(at(10, 30).toISOString());
  });
});
