import { expireHold } from "@slotkeep/db";
import { paymentGateway, type HoldJob, type Logger } from "@slotkeep/infra";

/**
 * Fires 10 minutes after a hold is created. Releases the slot if still unpaid and expires the
 * Stripe Checkout session so the customer can no longer pay for a slot we've given away. (Stripe
 * sessions live at least 30 minutes, longer than our hold, so this step is required.)
 */
export async function processHoldJob(data: HoldJob, log: Logger, now = new Date()) {
  const { expired, booking } = await expireHold(data.bookingId, now);
  if (!booking) return { status: "missing" };
  if (booking.status === "PENDING_PAYMENT") {
    // Ran early (clock skew or manual retry). Throwing makes BullMQ retry with backoff.
    throw new Error(
      `Hold for ${booking.id} not yet expired (expires ${booking.holdExpiresAt?.toISOString()})`,
    );
  }
  // Expire the session whenever the booking didn't end up paid, including holds released lazily
  // by a competing booking before this job ran.
  if (
    booking.stripeCheckoutSessionId &&
    booking.status === "CANCELLED" &&
    booking.depositPaidCents === 0
  ) {
    await paymentGateway().expireCheckout(booking.stripeCheckoutSessionId);
  }
  log.info({ bookingId: booking.id, expired, status: booking.status }, "hold job processed");
  return { status: expired ? "released" : "noop", bookingStatus: booking.status };
}
