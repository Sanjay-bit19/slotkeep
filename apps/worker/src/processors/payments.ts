import { getBookingWithRelations, recordRefund } from "@slotkeep/db";
import { enqueueBookingEmail, paymentGateway, type Logger, type RefundJob } from "@slotkeep/infra";

/**
 * Retryable refund. Stripe's idempotency key (refund-<bookingId>) guarantees that however many
 * times this runs, at most one refund is created; recordRefund is idempotent on our side too.
 */
export async function processRefundJob(data: RefundJob, log: Logger) {
  const b = await getBookingWithRelations(data.bookingId);
  if (!b) return { status: "missing" };
  if (!b.stripePaymentIntentId) {
    // Enqueued just before the webhook transaction committed; retry until it's visible.
    throw new Error(`Booking ${b.id} has no payment intent yet`);
  }
  if (!b.stripeRefundId && data.amountCents > 0) {
    const refund = await paymentGateway().refund({
      paymentIntentId: b.stripePaymentIntentId,
      amountCents: data.amountCents,
      idempotencyKey: `refund-${b.id}`,
      bookingId: b.id,
    });
    await recordRefund(b.id, refund.id, data.amountCents);
    log.info(
      { bookingId: b.id, refundId: refund.id, amountCents: data.amountCents },
      "refund issued",
    );
  }
  await enqueueBookingEmail(data.notify, b.id, { meta: data.meta, refundCents: data.amountCents });
  return { status: "refunded" };
}
