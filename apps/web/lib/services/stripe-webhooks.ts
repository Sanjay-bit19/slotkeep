import type Stripe from "stripe";
import { applyDepositPaid, prisma, type Prisma, type SubscriptionStatus } from "@slotkeep/db";
import {
  constructWebhookEvent,
  enqueueBookingEmail,
  enqueueRefund,
  enqueueReminder,
  type JobMeta,
  type Logger,
} from "@slotkeep/infra";

type Tx = Prisma.TransactionClient;

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Stripe webhook entry point.
 *
 * Signature: verified against the raw body before anything else (400 on failure).
 *
 * Idempotency: the event id is inserted into ProcessedWebhookEvent in the SAME transaction as the
 * event's effects. A redelivered (or concurrently delivered) event hits ON CONFLICT DO NOTHING
 * and is acknowledged without re-applying anything. If the effects fail, the insert rolls back
 * too and Stripe's retry gets a clean second attempt.
 *
 * Side effects (emails, refunds) are enqueued inside the transaction, right before commit. If
 * the commit then fails, the jobs run against unchanged state and no-op, because every consumer
 * re-checks booking state. If the job runs before the commit becomes visible, it retries.
 */
export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null,
  log: Logger,
  meta: JobMeta,
): Promise<WebhookResult> {
  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    log.warn({ err: (err as Error).message }, "stripe webhook signature verification failed");
    return { status: 400, body: { error: "Invalid signature" } };
  }
  const elog = log.child({ stripeEventId: event.id, stripeEventType: event.type });

  const outcome = await prisma.$transaction(
    async (tx) => {
      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "ProcessedWebhookEvent" ("id", "type", "processedAt")
        VALUES (${event.id}, ${event.type}, now())
        ON CONFLICT ("id") DO NOTHING
        RETURNING "id"`;
      if (inserted.length === 0) return "duplicate" as const;
      return applyEvent(tx, event, elog, meta);
    },
    { timeout: 20_000, maxWait: 10_000 },
  );

  if (outcome === "duplicate") {
    elog.info("duplicate stripe event ignored");
    return { status: 200, body: { received: true, duplicate: true } };
  }
  elog.info({ outcome }, "stripe event processed");
  return { status: 200, body: { received: true, outcome } };
}

async function applyEvent(
  tx: Tx,
  event: Stripe.Event,
  log: Logger,
  meta: JobMeta,
): Promise<string> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription") return linkSubscriptionCheckout(tx, session);
      if (session.payment_status !== "paid") return "awaiting-async-payment";
      return confirmDeposit(tx, session, log, meta);
    }
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const bookingId = session.metadata?.bookingId;
      if (session.mode !== "payment" || !bookingId) return "ignored";
      const res = await tx.booking.updateMany({
        where: { id: bookingId, status: "PENDING_PAYMENT" },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: "HOLD_EXPIRED",
          tokenVersion: { increment: 1 },
        },
      });
      return res.count ? "hold-released" : "noop";
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return syncSubscription(
        tx,
        event.data.object as Stripe.Subscription,
        event.type,
        new Date(event.created * 1000),
      );
    default:
      return "ignored";
  }
}

async function confirmDeposit(
  tx: Tx,
  session: Stripe.Checkout.Session,
  log: Logger,
  meta: JobMeta,
): Promise<string> {
  const bookingId = session.metadata?.bookingId ?? session.client_reference_id;
  if (!bookingId) {
    log.warn("deposit session without bookingId metadata");
    return "missing-booking-id";
  }
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  const { outcome, booking } = await applyDepositPaid(tx, {
    bookingId,
    paymentIntentId,
    amountCents: session.amount_total ?? 0,
    now: new Date(),
  });
  log.info({ bookingId, outcome }, "deposit applied");

  if ((outcome === "CONFIRMED" || outcome === "REINSTATED") && booking) {
    await enqueueBookingEmail("booking-confirmed", booking.id, { meta, delay: 1_000 });
    await enqueueReminder(booking.id, booking.startAt, meta);
  } else if (outcome === "CONFLICT" && booking) {
    // Paid for a slot that's gone: refund in full, then apologize. The refund job retries.
    await enqueueRefund(booking.id, booking.depositPaidCents, "payment-conflict", meta, {
      delay: 1_000,
    });
  }
  return outcome;
}

async function linkSubscriptionCheckout(tx: Tx, session: Stripe.Checkout.Session): Promise<string> {
  const tenantId = session.metadata?.tenantId ?? session.client_reference_id;
  if (!tenantId) return "missing-tenant";
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subscription =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  const res = await tx.tenant.updateMany({
    where: { id: tenantId },
    data: {
      stripeCustomerId: customer ?? undefined,
      stripeSubscriptionId: subscription ?? undefined,
      plan: "PRO",
    },
  });
  return res.count ? "subscription-linked" : "tenant-not-found";
}

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: "ACTIVE",
  trialing: "TRIALING",
  past_due: "PAST_DUE",
  canceled: "CANCELED",
  incomplete: "INCOMPLETE",
  incomplete_expired: "CANCELED",
  unpaid: "UNPAID",
  paused: "UNPAID",
};

function periodEnd(sub: Stripe.Subscription): Date | null {
  // Newer API versions moved current_period_end from the subscription onto its items.
  const top = (sub as unknown as { current_period_end?: number }).current_period_end;
  const item = (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)
    ?.current_period_end;
  const ts = top ?? item;
  return ts ? new Date(ts * 1000) : null;
}

async function syncSubscription(
  tx: Tx,
  sub: Stripe.Subscription,
  type: string,
  eventAt: Date,
): Promise<string> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const tenant = await tx.tenant.findFirst({
    where: sub.metadata?.tenantId
      ? { id: sub.metadata.tenantId }
      : { stripeCustomerId: customerId },
  });
  if (!tenant) return "tenant-not-found";
  // Stripe doesn't guarantee ordering; never let an older event overwrite newer state.
  if (tenant.billingEventAt && tenant.billingEventAt > eventAt) return "stale-event";

  const status =
    type === "customer.subscription.deleted"
      ? "CANCELED"
      : (STATUS_MAP[sub.status] ?? "INCOMPLETE");
  await tx.tenant.update({
    where: { id: tenant.id },
    data: {
      plan: "PRO",
      subscriptionStatus: status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      currentPeriodEnd: periodEnd(sub),
      billingEventAt: eventAt,
    },
  });
  return `subscription-${status.toLowerCase()}`;
}
