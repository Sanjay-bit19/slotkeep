import { getBookingWithRelations, type BookingWithRelations } from "@slotkeep/db";
import type { BookingEmailKind } from "./queues";
import { sendEmail, type SendEmailResult } from "./email/send";
import {
  bookingCancelledEmail,
  bookingConfirmedEmail,
  bookingReminderEmail,
  bookingRescheduledEmail,
  paymentConflictEmail,
  type BookingEmailData,
  type RenderedEmail,
} from "./email/templates";
import { manageUrlFor } from "./links";
import { logger } from "./logger";

function emailData(b: BookingWithRelations, withManageLink: boolean): BookingEmailData {
  return {
    businessName: b.tenant.name,
    brandColor: b.tenant.brandColor,
    timezone: b.tenant.timezone,
    customerName: b.customer.name,
    serviceName: b.service.name,
    staffName: b.staff.name,
    startAt: b.startAt,
    priceCents: b.priceCents,
    depositPaidCents: b.depositPaidCents,
    currency: b.currency,
    cancellationWindowHours: b.tenant.cancellationWindowHours,
    manageUrl: withManageLink ? manageUrlFor(b) : undefined,
  };
}

/**
 * Renders and sends one booking email. Each kind re-checks the booking's current state, because
 * jobs can run long after they were enqueued (a reminder for a booking cancelled yesterday must
 * not go out).
 */
export async function sendBookingEmail(
  kind: BookingEmailKind,
  bookingId: string,
  opts: { refundCents?: number } = {},
): Promise<SendEmailResult | { status: "obsolete" }> {
  const b = await getBookingWithRelations(bookingId);
  if (!b) return { status: "obsolete" };

  let rendered: RenderedEmail;
  let dedupeKey: string;
  switch (kind) {
    case "booking-confirmed":
      // Enqueued just before the confirming transaction commits; if we got here first, retry.
      if (b.status === "PENDING_PAYMENT") throw new Error("Booking not confirmed yet; will retry");
      if (b.status !== "CONFIRMED") return { status: "obsolete" };
      rendered = bookingConfirmedEmail(emailData(b, true));
      dedupeKey = `confirmed:${b.id}`;
      break;
    case "booking-reminder":
      if (b.status !== "CONFIRMED") return { status: "obsolete" };
      rendered = bookingReminderEmail(emailData(b, true));
      dedupeKey = `reminder:${b.id}:${b.startAt.getTime()}`;
      break;
    case "booking-rescheduled":
      if (b.status !== "CONFIRMED") return { status: "obsolete" };
      rendered = bookingRescheduledEmail(emailData(b, true));
      dedupeKey = `rescheduled:${b.id}:${b.tokenVersion}`;
      break;
    case "booking-cancelled":
      if (b.status !== "CANCELLED") return { status: "obsolete" };
      rendered = bookingCancelledEmail({
        ...emailData(b, false),
        refundCents: opts.refundCents ?? b.refundedCents,
      });
      dedupeKey = `cancelled:${b.id}`;
      break;
    case "payment-conflict":
      rendered = paymentConflictEmail({
        ...emailData(b, false),
        refundCents: opts.refundCents ?? b.depositPaidCents,
      });
      dedupeKey = `conflict:${b.id}`;
      break;
    default: {
      const never: never = kind;
      throw new Error(`Unknown email kind ${String(never)}`);
    }
  }
  logger.debug({ kind, bookingId }, "sending booking email");
  return sendEmail({
    ...rendered,
    to: b.customer.email,
    template: kind,
    tenantId: b.tenantId,
    bookingId: b.id,
    dedupeKey,
  });
}
