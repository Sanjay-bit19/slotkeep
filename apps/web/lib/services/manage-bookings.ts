import {
  cancelBooking,
  DomainError,
  getBookingWithRelations,
  InvalidStateError,
  recordRefund,
  rescheduleBooking,
  setBookingOutcome,
  type CancelResult,
} from "@slotkeep/db";
import {
  enqueueBookingEmail,
  enqueueRefund,
  enqueueReminder,
  paymentGateway,
  verifyManageLinkToken,
  type JobMeta,
  type Logger,
} from "@slotkeep/infra";
import { requireTenantById, type TenantContext } from "../authz";

export interface CancelOutcome {
  refundCents: number;
  refundStatus: "none" | "refunded" | "pending";
}

/**
 * Shared cancel path for owners and customers: flip the booking to CANCELLED (DB transaction),
 * then refund via Stripe with an idempotency key. If Stripe is unreachable the refund is queued
 * and retried with backoff; the customer sees "refund pending" rather than an error, because the
 * cancellation itself already happened.
 */
async function finishCancellation(
  res: CancelResult,
  log: Logger,
  meta: JobMeta,
): Promise<CancelOutcome> {
  const b = res.booking;
  const gateway = paymentGateway();

  if (res.previousStatus === "PENDING_PAYMENT" && b.stripeCheckoutSessionId) {
    await gateway
      .expireCheckout(b.stripeCheckoutSessionId)
      .catch((err) => log.warn({ err }, "expire checkout failed"));
  }

  let refundStatus: CancelOutcome["refundStatus"] = "none";
  if (res.refundCents > 0 && b.stripePaymentIntentId) {
    try {
      const refund = await gateway.refund({
        paymentIntentId: b.stripePaymentIntentId,
        amountCents: res.refundCents,
        idempotencyKey: `refund-${b.id}`,
        bookingId: b.id,
      });
      await recordRefund(b.id, refund.id, res.refundCents);
      refundStatus = "refunded";
    } catch (err) {
      log.error({ err, bookingId: b.id }, "inline refund failed; queued for retry");
      await enqueueRefund(b.id, res.refundCents, "booking-cancelled", meta);
      return { refundCents: res.refundCents, refundStatus: "pending" };
    }
  }

  if (res.previousStatus !== "PENDING_PAYMENT") {
    await enqueueBookingEmail("booking-cancelled", b.id, { meta, refundCents: res.refundCents });
  }
  log.info({ bookingId: b.id, refundCents: res.refundCents, refundStatus }, "booking cancelled");
  return { refundCents: res.refundCents, refundStatus };
}

export async function cancelAsOwner(
  ctx: TenantContext,
  bookingId: string,
  log: Logger,
  meta: JobMeta,
) {
  const res = await cancelBooking({
    tenantId: ctx.tenant.id,
    bookingId,
    by: "OWNER",
    now: new Date(),
  });
  return finishCancellation(res, log, meta);
}

export async function markOutcome(
  ctx: TenantContext,
  bookingId: string,
  status: "COMPLETED" | "NO_SHOW",
) {
  return setBookingOutcome({ tenantId: ctx.tenant.id, bookingId, status, now: new Date() });
}

/** Resolves a self-service link to its booking, enforcing signature, expiry and revocation. */
export async function bookingFromToken(token: string) {
  const v = verifyManageLinkToken(token);
  if (!v.ok) {
    throw new DomainError(
      "INVALID_LINK",
      v.reason === "EXPIRED" ? "This link has expired." : "This link is not valid.",
      v.reason === "EXPIRED" ? 410 : 404,
    );
  }
  const booking = await getBookingWithRelations(v.payload.b);
  if (!booking) throw new DomainError("INVALID_LINK", "This link is not valid.", 404);
  return { booking, version: v.payload.v, current: booking.tokenVersion === v.payload.v };
}

export async function cancelAsCustomer(token: string, log: Logger, meta: JobMeta) {
  const { booking, version, current } = await bookingFromToken(token);
  if (!current)
    throw new InvalidStateError(
      "This link is no longer valid. Use the most recent email from the business.",
    );
  const res = await cancelBooking({
    tenantId: booking.tenantId,
    bookingId: booking.id,
    by: "CUSTOMER",
    now: new Date(),
    expectedTokenVersion: version,
  });
  return finishCancellation(res, log, meta);
}

export async function rescheduleAsCustomer(
  token: string,
  newStart: Date,
  log: Logger,
  meta: JobMeta,
) {
  const { booking, version } = await bookingFromToken(token);
  const updated = await rescheduleBooking({
    tenantId: booking.tenantId,
    bookingId: booking.id,
    newStart,
    now: new Date(),
    expectedTokenVersion: version,
  });
  await enqueueBookingEmail("booking-rescheduled", updated.id, {
    meta,
    dedupe: String(updated.tokenVersion),
  });
  await enqueueReminder(updated.id, updated.startAt, meta);
  log.info({ bookingId: updated.id, newStart: updated.startAt }, "booking rescheduled by customer");
  return updated;
}

/** Used by tests to assert authz wiring end-to-end without a page. */
export async function cancelAsOwnerByTenantId(tenantId: string, bookingId: string, log: Logger) {
  const ctx = await requireTenantById(tenantId, "booking:cancel");
  return cancelAsOwner(ctx, bookingId, log, {});
}
