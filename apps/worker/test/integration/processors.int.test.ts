import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import { applyDepositPaid, createBooking, prisma } from "@slotkeep/db";
import {
  closeQueues,
  getQueue,
  logger,
  QUEUE_NAMES,
  redis,
  setPaymentGateway,
  type PaymentGateway,
} from "@slotkeep/infra";
import { handleFailure } from "../../src/dead-letter";
import { processEmailJob, sendDailySummary } from "../../src/processors/email";
import { processHoldJob } from "../../src/processors/holds";
import { fanOutDailySummaries, sweepHolds } from "../../src/processors/maintenance";
import { processRefundJob } from "../../src/processors/payments";
import {
  NOW,
  SLOT,
  createTenantFixture,
  customer,
  resetDb,
} from "../../../../packages/db/test/fixtures";

const calls: Array<[string, unknown]> = [];
const gateway: PaymentGateway = {
  mode: "fake",
  createDepositCheckout: async () => ({ id: "cs_x", url: "http://x" }),
  expireCheckout: async (id) => void calls.push(["expire", id]),
  refund: async (input) => {
    calls.push(["refund", input]);
    return { id: `re_${input.idempotencyKey}` };
  },
  createSubscriptionCheckout: async () => ({ id: "cs_s", url: "http://x" }),
  createBillingPortal: async () => ({ url: "http://x" }),
};

beforeEach(async () => {
  await resetDb();
  await redis().flushdb();
  calls.length = 0;
  setPaymentGateway(gateway);
});
afterAll(async () => {
  setPaymentGateway(undefined);
  await closeQueues();
  await prisma.$disconnect();
});

const min = (n: number) => n * 60_000;

describe("hold expiry job", () => {
  it("releases an unpaid hold and expires its checkout session", async () => {
    const fx = await createTenantFixture();
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    await prisma.booking.update({
      where: { id: b.id },
      data: { stripeCheckoutSessionId: "cs_hold" },
    });
    const res = await processHoldJob(
      { bookingId: b.id },
      logger,
      new Date(NOW.getTime() + min(10)),
    );
    expect(res).toMatchObject({ status: "released", bookingStatus: "CANCELLED" });
    expect(calls).toEqual([["expire", "cs_hold"]]);
  });

  it("does nothing to a paid booking", async () => {
    const fx = await createTenantFixture();
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    await prisma.$transaction((tx) =>
      applyDepositPaid(tx, { bookingId: b.id, paymentIntentId: "pi", amountCents: 1000, now: NOW }),
    );
    const res = await processHoldJob(
      { bookingId: b.id },
      logger,
      new Date(NOW.getTime() + min(10)),
    );
    expect(res).toMatchObject({ status: "noop", bookingStatus: "CONFIRMED" });
    expect(calls).toEqual([]);
  });

  it("throws (so BullMQ retries) if it runs before the hold expires", async () => {
    const fx = await createTenantFixture();
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    await expect(
      processHoldJob({ bookingId: b.id }, logger, new Date(NOW.getTime() + min(5))),
    ).rejects.toThrow(/not yet expired/);
  });

  it("the sweeper releases overdue holds whose job was lost", async () => {
    const fx = await createTenantFixture();
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    await prisma.booking.update({
      where: { id: b.id },
      data: { stripeCheckoutSessionId: "cs_lost" },
    });
    expect(await sweepHolds(logger, new Date(NOW.getTime() + min(11)))).toEqual({ released: 1 });
    expect(calls).toEqual([["expire", "cs_lost"]]);
  });
});

describe("refund job", () => {
  it("refunds once (idempotency key), records it, and is safe to retry", async () => {
    const fx = await createTenantFixture();
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    await prisma.$transaction((tx) =>
      applyDepositPaid(tx, {
        bookingId: b.id,
        paymentIntentId: "pi_r",
        amountCents: 1000,
        now: NOW,
      }),
    );
    await processRefundJob(
      { kind: "refund", bookingId: b.id, amountCents: 1000, notify: "booking-cancelled" },
      logger,
    );
    await processRefundJob(
      { kind: "refund", bookingId: b.id, amountCents: 1000, notify: "booking-cancelled" },
      logger,
    );
    expect(calls.filter(([k]) => k === "refund")).toHaveLength(1);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
      refundedCents: 1000,
      stripeRefundId: `re_refund-${b.id}`,
    });
  });

  it("retries while the payment intent isn't visible yet", async () => {
    const fx = await createTenantFixture();
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    await expect(
      processRefundJob(
        { kind: "refund", bookingId: b.id, amountCents: 1000, notify: "payment-conflict" },
        logger,
      ),
    ).rejects.toThrow(/no payment intent/);
  });
});

describe("email jobs", () => {
  it("sends a confirmation once (dedupe) and skips obsolete reminders", async () => {
    const fx = await createTenantFixture({ depositCents: 0 });
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(3),
      now: NOW,
    });
    expect(
      await processEmailJob({ kind: "booking-confirmed", bookingId: b.id }, logger),
    ).toMatchObject({ status: "logged" });
    expect(
      await processEmailJob({ kind: "booking-confirmed", bookingId: b.id }, logger),
    ).toMatchObject({ status: "skipped" });
    const log = await prisma.emailLog.findFirstOrThrow({ where: { bookingId: b.id } });
    expect(log.to).toBe("c3@example.com");
    expect(log.body).toContain("/m/");
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED" } });
    expect(await processEmailJob({ kind: "booking-reminder", bookingId: b.id }, logger)).toEqual({
      status: "obsolete",
    });
  });

  it("confirmation retries while the booking is still pending (enqueued before commit)", async () => {
    const fx = await createTenantFixture();
    const b = await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    await expect(
      processEmailJob({ kind: "booking-confirmed", bookingId: b.id }, logger),
    ).rejects.toThrow(/not confirmed yet/);
  });

  it("daily summary goes to every owner with today's confirmed bookings", async () => {
    const fx = await createTenantFixture({ depositCents: 0 });
    await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: SLOT,
      customer: customer(),
      now: NOW,
    });
    const res = await sendDailySummary(fx.tenant.id, "2030-03-04", logger);
    expect(res).toMatchObject({ status: "sent", recipients: 1 });
    const email = await prisma.emailLog.findFirstOrThrow({ where: { template: "daily-summary" } });
    expect(email.subject).toContain("1 appointment");
  });

  it("fans out summaries only to tenants where it's 7am locally", async () => {
    const ny = await createTenantFixture({ timezone: "America/New_York" });
    await createTenantFixture({ timezone: "Asia/Tokyo" });
    // 12:00 UTC on 2030-03-04 = 07:00 in New York (EST), 21:00 in Tokyo.
    const res = await fanOutDailySummaries(logger, new Date("2030-03-04T12:00:00Z"));
    expect(res).toEqual({ enqueued: 1 });
    const job = await getQueue(QUEUE_NAMES.email).getJob(
      `daily-summary-${ny.tenant.id}-2030-03-04`,
    );
    expect(job).toBeTruthy();
  });
});

describe("dead-letter queue", () => {
  it("only dead-letters after the final attempt", async () => {
    const job = {
      id: "j1",
      name: "booking-confirmed",
      data: { bookingId: "b" },
      opts: { attempts: 5 },
      attemptsMade: 3,
    } as unknown as Job;
    expect(await handleFailure("email", job, new Error("boom"), logger)).toBe(false);
    const final = { ...job, attemptsMade: 5 } as unknown as Job;
    expect(await handleFailure("email", final, new Error("boom"), logger)).toBe(true);
    const dlq = await getQueue(QUEUE_NAMES.deadLetter).getJob("dlq-email-j1");
    expect(dlq!.data).toMatchObject({ queue: "email", failedReason: "boom", attemptsMade: 5 });
  });
});
