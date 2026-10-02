import { createBookingSchema, formatInTimeZone, type CreateBookingInput } from "@slotkeep/core";
import {
  attachCheckoutSession,
  createBooking,
  NotFoundError,
  prisma,
  type BookingWithRelations,
} from "@slotkeep/db";
import {
  enqueueBookingEmail,
  enqueueHoldExpiry,
  enqueueReminder,
  env,
  manageUrlFor,
  paymentGateway,
  type Logger,
} from "@slotkeep/infra";

export type StartBookingResult =
  | { kind: "checkout"; bookingId: string; checkoutUrl: string; holdExpiresAt: string }
  | { kind: "confirmed"; bookingId: string; redirectUrl: string };

export async function findPublicTenant(slug: string) {
  return prisma.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      brandColor: true,
      cancellationWindowHours: true,
    },
  });
}

export function successUrlFor(
  b: Pick<BookingWithRelations, "id" | "tokenVersion" | "startAt">,
  slug: string,
) {
  const manage = manageUrlFor(b);
  const token = manage.slice(manage.lastIndexOf("/") + 1);
  return `${env().APP_URL}/b/${slug}/success?t=${encodeURIComponent(token)}`;
}

/**
 * Public booking entry point (POST /api/public/[slug]/bookings).
 *
 * 1. Validate input (zod; same schema the client form uses).
 * 2. Create the booking. The DB exclusion constraint is the authority on conflicts.
 * 3. Deposit services: open a Stripe Checkout session and schedule the 10-minute hold expiry.
 *    The booking is NOT confirmed here or on the success redirect; only the webhook confirms.
 * 4. No-deposit services: confirmed immediately; schedule confirmation + reminder emails.
 */
export async function startPublicBooking(args: {
  slug: string;
  body: unknown;
  requestId: string;
  log: Logger;
  now?: Date;
}): Promise<StartBookingResult> {
  const now = args.now ?? new Date();
  const input: CreateBookingInput = createBookingSchema.parse(args.body);
  const tenant = await findPublicTenant(args.slug);
  if (!tenant) throw new NotFoundError("Business");

  const booking = await createBooking({
    tenantId: tenant.id,
    serviceId: input.serviceId,
    staffId: input.staffId && input.staffId !== "any" ? input.staffId : undefined,
    start: new Date(input.start),
    customer: { name: input.name, email: input.email, phone: input.phone, notes: input.notes },
    now,
  });
  const meta = { requestId: args.requestId };
  const log = args.log.child({ bookingId: booking.id, tenantId: tenant.id });

  if (booking.status === "CONFIRMED") {
    await Promise.all([
      enqueueBookingEmail("booking-confirmed", booking.id, { meta }),
      enqueueReminder(booking.id, booking.startAt, meta, now),
    ]);
    log.info("booking confirmed (no deposit)");
    return {
      kind: "confirmed",
      bookingId: booking.id,
      redirectUrl: successUrlFor(booking, tenant.slug),
    };
  }

  // Schedule the release first: if anything below fails, the hold still expires on time.
  await enqueueHoldExpiry(booking.id, booking.holdExpiresAt!, meta, now);
  try {
    const session = await paymentGateway().createDepositCheckout({
      bookingId: booking.id,
      tenantId: tenant.id,
      amountCents: booking.depositCents,
      currency: booking.currency,
      customerEmail: booking.customer.email,
      productName: `Deposit: ${booking.service.name} at ${tenant.name}`,
      description: `${formatInTimeZone(booking.startAt, tenant.timezone, "ccc LLL d, h:mm a ZZZZ")} with ${booking.staff.name}`,
      successUrl: successUrlFor(booking, tenant.slug),
      cancelUrl: `${env().APP_URL}/b/${tenant.slug}?cancelled=1`,
    });
    await attachCheckoutSession(booking.id, session.id);
    log.info({ checkoutSessionId: session.id }, "slot held; checkout started");
    return {
      kind: "checkout",
      bookingId: booking.id,
      checkoutUrl: session.url,
      holdExpiresAt: booking.holdExpiresAt!.toISOString(),
    };
  } catch (err) {
    // Release the slot immediately rather than making the next customer wait 10 minutes.
    await prisma.booking.updateMany({
      where: { id: booking.id, status: "PENDING_PAYMENT" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "HOLD_EXPIRED" },
    });
    log.error({ err }, "checkout creation failed; hold released");
    throw err;
  }
}
