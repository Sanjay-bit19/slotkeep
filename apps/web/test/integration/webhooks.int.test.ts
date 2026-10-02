import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBooking, prisma } from "@slotkeep/db";
import { POST } from "@/app/api/webhooks/stripe/route";
import { createTenantFixture, customer, resetDb } from "../../../../packages/db/test/fixtures";
import {
  closeQueues,
  flushRedis,
  jobIds,
  QUEUE_NAMES,
  stripeEvent,
  webhookRequest,
} from "./helpers";

// Real "now" here: the webhook handler stamps confirmations with the current time.
const NOW = new Date();
const FUTURE_SLOT = new Date(Date.UTC(NOW.getUTCFullYear() + 1, 2, 4, 15, 0)); // a Monday-ish weekday next year

async function heldBooking() {
  const fx = await createTenantFixture();
  // Find a valid open slot next year at 10:00 New York time on a weekday.
  const start = new Date(FUTURE_SLOT);
  const b = await createBooking({
    tenantId: fx.tenant.id,
    serviceId: fx.serviceId,
    start,
    customer: customer(1),
    now: NOW,
  });
  await prisma.booking.update({
    where: { id: b.id },
    data: { stripeCheckoutSessionId: `cs_test_${b.id}` },
  });
  return { fx, b };
}

function completed(bookingId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `cs_test_${bookingId}`,
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    amount_total: 1000,
    currency: "usd",
    payment_intent: `pi_${bookingId}`,
    client_reference_id: bookingId,
    metadata: { bookingId, kind: "deposit" },
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDb();
  await flushRedis();
});
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

describe("POST /api/webhooks/stripe", () => {
  it("rejects missing or invalid signatures without touching the database", async () => {
    const { b } = await heldBooking();
    const ev = stripeEvent("checkout.session.completed", completed(b.id));
    expect((await POST(webhookRequest(ev.payload, null))).status).toBe(400);
    expect((await POST(webhookRequest(ev.payload, "t=1,v1=deadbeef"))).status).toBe(400);
    // Tampered body with a signature for the original body.
    const tampered = ev.payload.replace('"amount_total":1000', '"amount_total":1');
    expect((await POST(webhookRequest(tampered, ev.signature))).status).toBe(400);
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).toBe(
      "PENDING_PAYMENT",
    );
    expect(await prisma.processedWebhookEvent.count()).toBe(0);
  });

  it("confirms the booking and enqueues confirmation + reminder emails", async () => {
    const { b } = await heldBooking();
    const ev = stripeEvent("checkout.session.completed", completed(b.id));
    const res = await POST(webhookRequest(ev.payload, ev.signature));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, outcome: "CONFIRMED" });
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(booking).toMatchObject({
      status: "CONFIRMED",
      depositPaidCents: 1000,
      stripePaymentIntentId: `pi_${b.id}`,
    });
    const ids = await jobIds(QUEUE_NAMES.email);
    expect(ids).toContain(`booking-confirmed-${b.id}`);
    expect(ids).toContain(`booking-reminder-${b.id}-${booking.startAt.getTime()}`);
    // Request id from the webhook request is propagated into the job.
    const { getQueue } = await import("@slotkeep/infra");
    const job = await getQueue(QUEUE_NAMES.email).getJob(`booking-confirmed-${b.id}`);
    expect((job!.data as { meta: { requestId: string } }).meta.requestId).toBe("req-test-123");
  });

  it("is idempotent: redelivery of the same event is acknowledged and not re-applied", async () => {
    const { b } = await heldBooking();
    const ev = stripeEvent("checkout.session.completed", completed(b.id), "evt_same");
    expect((await (await POST(webhookRequest(ev.payload, ev.signature))).json()).outcome).toBe(
      "CONFIRMED",
    );
    const again = await POST(webhookRequest(ev.payload, ev.signature));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(await prisma.processedWebhookEvent.count()).toBe(1);
  });

  it("is idempotent under concurrent duplicate delivery", async () => {
    const { b } = await heldBooking();
    const ev = stripeEvent("checkout.session.completed", completed(b.id), "evt_concurrent");
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        POST(webhookRequest(ev.payload, ev.signature)).then((r) => r.json()),
      ),
    );
    expect(results.filter((r) => r.outcome === "CONFIRMED")).toHaveLength(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(4);
  });

  it("never confirms an unpaid (async) checkout", async () => {
    const { b } = await heldBooking();
    const ev = stripeEvent(
      "checkout.session.completed",
      completed(b.id, { payment_status: "unpaid" }),
    );
    expect((await (await POST(webhookRequest(ev.payload, ev.signature))).json()).outcome).toBe(
      "awaiting-async-payment",
    );
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).toBe(
      "PENDING_PAYMENT",
    );
  });

  it("late payment for a slot someone else took => CONFLICT and a refund job", async () => {
    const { fx, b } = await heldBooking();
    // Hold expires, another customer books the same time.
    await prisma.booking.update({
      where: { id: b.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    await createBooking({
      tenantId: fx.tenant.id,
      serviceId: fx.serviceId,
      start: b.startAt,
      customer: customer(2),
      now: new Date(),
    });
    const ev = stripeEvent("checkout.session.completed", completed(b.id));
    expect((await (await POST(webhookRequest(ev.payload, ev.signature))).json()).outcome).toBe(
      "CONFLICT",
    );
    expect(await jobIds(QUEUE_NAMES.payments)).toEqual([`refund-${b.id}`]);
  });

  it("checkout.session.expired releases an unpaid hold", async () => {
    const { b } = await heldBooking();
    const ev = stripeEvent(
      "checkout.session.expired",
      completed(b.id, { payment_status: "unpaid" }),
    );
    expect((await (await POST(webhookRequest(ev.payload, ev.signature))).json()).outcome).toBe(
      "hold-released",
    );
    expect(await prisma.booking.findUnique({ where: { id: b.id } })).toMatchObject({
      status: "CANCELLED",
      cancelReason: "HOLD_EXPIRED",
    });
  });

  describe("subscriptions", () => {
    const sub = (tenantId: string, status: string, periodEnd: number) => ({
      id: "sub_1",
      object: "subscription",
      customer: "cus_1",
      status,
      metadata: { tenantId },
      items: {
        object: "list",
        data: [{ id: "si_1", current_period_end: periodEnd, price: { id: "price_pro" } }],
      },
    });

    it("links checkout, applies status changes, and ignores stale out-of-order events", async () => {
      const fx = await createTenantFixture({ plan: "FREE" });
      const t0 = Math.floor(Date.now() / 1000);
      const link = stripeEvent("checkout.session.completed", {
        id: "cs_sub",
        object: "checkout.session",
        mode: "subscription",
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: fx.tenant.id,
        metadata: { tenantId: fx.tenant.id },
      });
      await POST(webhookRequest(link.payload, link.signature));
      const created = stripeEvent(
        "customer.subscription.created",
        sub(fx.tenant.id, "active", t0 + 30 * 86400),
        undefined,
        t0,
      );
      await POST(webhookRequest(created.payload, created.signature));
      let tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: fx.tenant.id } });
      expect(tenant).toMatchObject({
        plan: "PRO",
        subscriptionStatus: "ACTIVE",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
      });
      expect(tenant.currentPeriodEnd!.getTime()).toBe((t0 + 30 * 86400) * 1000);

      const deleted = stripeEvent(
        "customer.subscription.deleted",
        sub(fx.tenant.id, "canceled", t0 + 30 * 86400),
        undefined,
        t0 + 100,
      );
      await POST(webhookRequest(deleted.payload, deleted.signature));
      // An older "updated: past_due" arriving after the deletion must not resurrect it.
      const stale = stripeEvent(
        "customer.subscription.updated",
        sub(fx.tenant.id, "past_due", t0 + 30 * 86400),
        undefined,
        t0 + 50,
      );
      expect(
        (await (await POST(webhookRequest(stale.payload, stale.signature))).json()).outcome,
      ).toBe("stale-event");
      tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: fx.tenant.id } });
      expect(tenant.subscriptionStatus).toBe("CANCELED");
    });
  });
});
