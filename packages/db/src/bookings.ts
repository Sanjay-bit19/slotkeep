import { randomUUID } from "node:crypto";
import {
  addMinutes,
  canTransition,
  checkBookingLimit,
  computeRefundCents,
  computeSlots,
  effectivePlan,
  localMonthBounds,
  PLAN_LIMITS,
  toLocalDate,
  type BookingStatus,
} from "@slotkeep/core";
import { Prisma, type Booking, type PrismaClient } from "@prisma/client";
import { loadAvailabilityInput } from "./availability";
import { prisma } from "./client";
import {
  InvalidStateError,
  NotFoundError,
  PlanLimitError,
  SlotUnavailableError,
  isExclusionViolation,
} from "./errors";
import { forTenant } from "./tenant";

/** How long a slot is reserved while the customer is in Stripe Checkout. */
export const HOLD_MINUTES = 10;

type Tx = Prisma.TransactionClient;

export const bookingInclude = {
  service: true,
  staff: { select: { id: true, name: true } },
  customer: true,
  tenant: {
    select: { id: true, name: true, slug: true, timezone: true, brandColor: true, cancellationWindowHours: true },
  },
} satisfies Prisma.BookingInclude;

export type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export interface CustomerDetails {
  name: string;
  email: string;
  phone?: string;
  notes?: string;
}

export interface CreateBookingParams {
  tenantId: string;
  serviceId: string;
  /** Undefined means "any staff member". */
  staffId?: string;
  start: Date;
  customer: CustomerDetails;
  now: Date;
}

/**
 * Bookings created this calendar month (tenant timezone) that count against the plan quota.
 * Unpaid holds that expired never count; a booking that was confirmed and later cancelled does.
 */
export async function countMonthlyBookings(
  db: Tx | PrismaClient,
  tenantId: string,
  timezone: string,
  now: Date,
): Promise<number> {
  const { start, end } = localMonthBounds(now, timezone);
  const rows = await db.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM "Booking"
    WHERE "tenantId" = ${tenantId}
      AND "createdAt" >= ${start} AND "createdAt" < ${end}
      AND ("status" <> 'CANCELLED' OR "confirmedAt" IS NOT NULL)`;
  return rows[0]?.n ?? 0;
}

/**
 * Creates a booking for an open slot.
 *
 * Correctness does not depend on the availability check: two requests can both see the slot as
 * open. The `booking_no_overlap` exclusion constraint makes the second INSERT fail (23P01), which
 * we translate to SlotUnavailableError. For "any staff" we fall through to the next candidate.
 */
export async function createBooking(params: CreateBookingParams): Promise<BookingWithRelations> {
  const tenant = await prisma.tenant.findUnique({ where: { id: params.tenantId } });
  if (!tenant) throw new NotFoundError("Business");

  const localDate = toLocalDate(params.start, tenant.timezone);
  const loaded = await loadAvailabilityInput({
    tenant,
    serviceId: params.serviceId,
    staffId: params.staffId,
    fromDate: localDate,
    toDate: localDate,
    now: params.now,
  });
  if (!loaded) throw new NotFoundError("Service");

  const slot = computeSlots(loaded.input).find((s) => s.start.getTime() === params.start.getTime());
  if (!slot) throw new SlotUnavailableError();

  // Least-busy staff first so "any" spreads work evenly; deterministic tie-break by id.
  const load = new Map(loaded.input.staff.map((s) => [s.staffId, s.busy.length]));
  const candidates = [...slot.staffIds].sort(
    (a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b),
  );

  for (const staffId of candidates) {
    try {
      return await insertBooking({
        tenantId: tenant.id,
        timezone: tenant.timezone,
        staffId,
        service: loaded.service,
        start: params.start,
        customer: params.customer,
        now: params.now,
      });
    } catch (err) {
      if (isExclusionViolation(err)) continue;
      throw err;
    }
  }
  throw new SlotUnavailableError();
}

async function insertBooking(args: {
  tenantId: string;
  timezone: string;
  staffId: string;
  service: { id: string; durationMin: number; bufferMin: number; priceCents: number; depositCents: number; currency: string };
  start: Date;
  customer: CustomerDetails;
  now: Date;
}): Promise<BookingWithRelations> {
  const { tenantId, service, start, now, staffId } = args;
  const endAt = addMinutes(start, service.durationMin);
  const blockedUntil = addMinutes(endAt, service.bufferMin);
  const needsPayment = service.depositCents > 0;

  return prisma.$transaction(async (tx) => {
    const tenantRows = await tx.$queryRaw<
      Array<{ plan: "FREE" | "PRO"; subscriptionStatus: string; currentPeriodEnd: Date | null }>
    >`SELECT "plan", "subscriptionStatus", "currentPeriodEnd" FROM "Tenant" WHERE "id" = ${tenantId}`;
    const t = tenantRows[0];
    if (!t) throw new NotFoundError("Business");
    const plan = effectivePlan(
      { plan: t.plan, subscriptionStatus: t.subscriptionStatus as never, currentPeriodEnd: t.currentPeriodEnd },
      now,
    );

    if (Number.isFinite(PLAN_LIMITS[plan].maxBookingsPerMonth)) {
      // Serialize quota checks per tenant so two concurrent bookings at 49/50 can't both pass.
      // Only capped (free) tenants pay this cost; paid tenants never take the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quota:${tenantId}`}))`;
      const used = await countMonthlyBookings(tx, tenantId, args.timezone, now);
      const limit = checkBookingLimit(plan, used);
      if (!limit.ok) {
        throw new PlanLimitError(
          "BOOKING_LIMIT",
          "This business has reached its monthly booking limit. Please contact them directly.",
        );
      }
    }

    // Holds whose 10 minutes are up but whose expiry job hasn't run yet must not block a real
    // customer. Release overlapping ones here; the job later finds them already cancelled.
    await tx.$executeRaw`
      UPDATE "Booking"
      SET "status" = 'CANCELLED', "cancelledAt" = ${now}, "cancelReason" = 'HOLD_EXPIRED',
          "tokenVersion" = "tokenVersion" + 1, "updatedAt" = ${now}
      WHERE "staffId" = ${staffId}
        AND "status" = 'PENDING_PAYMENT'
        AND "holdExpiresAt" <= ${now}
        AND tstzrange("startAt", "blockedUntil", '[)') && tstzrange(${start}, ${blockedUntil}, '[)')`;

    // Atomic upsert (Prisma's upsert is read-then-write and races under concurrency).
    const customerRows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Customer" ("id", "tenantId", "name", "email", "phone", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${tenantId}, ${args.customer.name}, ${args.customer.email},
              ${args.customer.phone || null}, ${now}, ${now})
      ON CONFLICT ("tenantId", "email") DO UPDATE
        SET "name" = EXCLUDED."name",
            "phone" = COALESCE(EXCLUDED."phone", "Customer"."phone"),
            "updatedAt" = EXCLUDED."updatedAt"
      RETURNING "id"`;

    return tx.booking.create({
      data: {
        tenantId,
        serviceId: service.id,
        staffId,
        customerId: customerRows[0]!.id,
        startAt: start,
        endAt,
        blockedUntil,
        status: needsPayment ? "PENDING_PAYMENT" : "CONFIRMED",
        holdExpiresAt: needsPayment ? addMinutes(now, HOLD_MINUTES) : null,
        confirmedAt: needsPayment ? null : now,
        priceCents: service.priceCents,
        depositCents: service.depositCents,
        currency: service.currency,
        notes: args.customer.notes ?? "",
        // Use the injected clock so quota counting and tests agree on "this month".
        createdAt: now,
      },
      include: bookingInclude,
    });
  });
}

export async function attachCheckoutSession(bookingId: string, sessionId: string): Promise<void> {
  await prisma.booking.update({ where: { id: bookingId }, data: { stripeCheckoutSessionId: sessionId } });
}

export type DepositOutcome =
  | "CONFIRMED"
  | "ALREADY_CONFIRMED"
  | "REINSTATED"
  | "CONFLICT"
  | "NOT_FOUND";

/**
 * Applies a successful deposit payment. Called only from the Stripe webhook handler, inside the
 * same transaction that records the event id (idempotency).
 *
 * - PENDING_PAYMENT -> CONFIRMED (normal path).
 * - CANCELLED because the hold expired (customer paid late): re-confirm if the slot is still free,
 *   otherwise report CONFLICT so the caller refunds. The NOT EXISTS check plus the exclusion
 *   constraint make this race-safe: if a concurrent booking wins, this statement errors, the
 *   webhook returns 500, Stripe redelivers, and the retry takes the CONFLICT branch.
 */
export async function applyDepositPaid(
  tx: Tx,
  args: { bookingId: string; paymentIntentId: string | null; amountCents: number; now: Date },
): Promise<{ outcome: DepositOutcome; booking: Booking | null }> {
  const rows = await tx.$queryRaw<Booking[]>`SELECT * FROM "Booking" WHERE "id" = ${args.bookingId} FOR UPDATE`;
  const b = rows[0];
  if (!b) return { outcome: "NOT_FOUND", booking: null };

  if (b.status === "CONFIRMED" || b.status === "COMPLETED" || b.status === "NO_SHOW") {
    return { outcome: "ALREADY_CONFIRMED", booking: b };
  }

  if (b.status === "PENDING_PAYMENT") {
    const updated = await tx.booking.update({
      where: { id: b.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: args.now,
        holdExpiresAt: null,
        depositPaidCents: args.amountCents,
        stripePaymentIntentId: args.paymentIntentId,
      },
    });
    return { outcome: "CONFIRMED", booking: updated };
  }

  // CANCELLED
  if (b.cancelReason === "HOLD_EXPIRED") {
    // Overdue holds by other customers lose to money that has actually arrived.
    await tx.$executeRaw`
      UPDATE "Booking"
      SET "status" = 'CANCELLED', "cancelledAt" = ${args.now}, "cancelReason" = 'HOLD_EXPIRED',
          "tokenVersion" = "tokenVersion" + 1, "updatedAt" = ${args.now}
      WHERE "staffId" = ${b.staffId} AND "id" <> ${b.id}
        AND "status" = 'PENDING_PAYMENT' AND "holdExpiresAt" <= ${args.now}
        AND tstzrange("startAt", "blockedUntil", '[)') && tstzrange(${b.startAt}, ${b.blockedUntil}, '[)')`;
    const n = await tx.$executeRaw`
      UPDATE "Booking" AS b
      SET "status" = 'CONFIRMED', "confirmedAt" = ${args.now}, "holdExpiresAt" = NULL,
          "cancelledAt" = NULL, "cancelReason" = NULL,
          "depositPaidCents" = ${args.amountCents}, "stripePaymentIntentId" = ${args.paymentIntentId},
          "updatedAt" = ${args.now}
      WHERE b."id" = ${b.id} AND b."status" = 'CANCELLED'
        AND NOT EXISTS (
          SELECT 1 FROM "Booking" o
          WHERE o."staffId" = b."staffId" AND o."id" <> b."id"
            AND o."status" IN ('PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'NO_SHOW')
            AND NOT (o."status" = 'PENDING_PAYMENT' AND o."holdExpiresAt" <= ${args.now})
            AND tstzrange(o."startAt", o."blockedUntil", '[)') && tstzrange(b."startAt", b."blockedUntil", '[)')
        )`;
    if (n === 1) {
      return { outcome: "REINSTATED", booking: await tx.booking.findUnique({ where: { id: b.id } }) };
    }
  }

  // Money arrived for a booking we cannot honour. Record it so the refund is traceable.
  const updated = await tx.booking.update({
    where: { id: b.id },
    data: {
      depositPaidCents: args.amountCents,
      stripePaymentIntentId: args.paymentIntentId,
      cancelReason: b.cancelReason === "HOLD_EXPIRED" ? "PAYMENT_CONFLICT" : b.cancelReason,
    },
  });
  return { outcome: "CONFLICT", booking: updated };
}

/**
 * Releases an unpaid hold whose time is up. Safe to call repeatedly and early (no-op until
 * holdExpiresAt has passed). Returns the booking either way so the caller can expire the Stripe
 * Checkout session for a hold that was released lazily by a competing booking.
 */
export async function expireHold(bookingId: string, now: Date): Promise<{ expired: boolean; booking: Booking | null }> {
  const res = await prisma.booking.updateMany({
    where: { id: bookingId, status: "PENDING_PAYMENT", holdExpiresAt: { lte: now } },
    data: { status: "CANCELLED", cancelledAt: now, cancelReason: "HOLD_EXPIRED", tokenVersion: { increment: 1 } },
  });
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  return { expired: res.count === 1, booking };
}

/** Releases every overdue hold (sweeper fallback for lost delayed jobs). Returns released ids. */
export async function expireOverdueHolds(now: Date, limit = 500): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Booking" SET "status" = 'CANCELLED', "cancelledAt" = ${now}, "cancelReason" = 'HOLD_EXPIRED',
        "tokenVersion" = "tokenVersion" + 1, "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "Booking"
      WHERE "status" = 'PENDING_PAYMENT' AND "holdExpiresAt" <= ${now}
      ORDER BY "holdExpiresAt" LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  return rows.map((r) => r.id);
}

export interface CancelResult {
  booking: BookingWithRelations;
  previousStatus: BookingStatus;
  refundCents: number;
}

/**
 * Cancels a booking and computes the refund owed under the tenant's policy. The refund itself
 * happens outside the transaction (it's a Stripe call); see recordRefund for the follow-up.
 */
export async function cancelBooking(args: {
  tenantId: string;
  bookingId: string;
  by: "OWNER" | "CUSTOMER";
  now: Date;
  /** For customer links: the token version the link was issued with. */
  expectedTokenVersion?: number;
}): Promise<CancelResult> {
  const db = forTenant(args.tenantId);
  return db.$transaction(async (tx) => {
    const b = await tx.booking.findUnique({ where: { id: args.bookingId }, include: bookingInclude });
    if (!b) throw new NotFoundError("Booking");
    if (args.expectedTokenVersion !== undefined && b.tokenVersion !== args.expectedTokenVersion) {
      throw new InvalidStateError("This link is no longer valid. Use the most recent email from the business.");
    }
    if (!canTransition(b.status, "CANCELLED")) {
      throw new InvalidStateError(`A ${b.status.toLowerCase().replace("_", " ")} booking cannot be cancelled`);
    }
    if (args.by === "CUSTOMER" && b.startAt <= args.now) {
      throw new InvalidStateError("This appointment has already started");
    }
    // Optimistic concurrency: only flip the row if nobody changed it since we read it.
    const res = await tx.booking.updateMany({
      where: { id: b.id, status: b.status, tokenVersion: b.tokenVersion },
      data: {
        status: "CANCELLED",
        cancelledAt: args.now,
        cancelReason: args.by,
        holdExpiresAt: null,
        tokenVersion: { increment: 1 },
      },
    });
    if (res.count !== 1) throw new InvalidStateError("This booking was changed by someone else. Refresh and try again.");

    const refundCents = computeRefundCents({
      depositPaidCents: b.depositPaidCents,
      alreadyRefundedCents: b.refundedCents,
      startAt: b.startAt,
      now: args.now,
      cancellationWindowHours: b.tenant.cancellationWindowHours,
      initiatedBy: args.by,
    });
    const fresh = await tx.booking.findUniqueOrThrow({ where: { id: b.id }, include: bookingInclude });
    return { booking: fresh, previousStatus: b.status, refundCents };
  });
}

/** Idempotent: a booking records at most one refund; replays with the same id are no-ops. */
export async function recordRefund(bookingId: string, refundId: string, amountCents: number): Promise<boolean> {
  const res = await prisma.$executeRaw`
    UPDATE "Booking" SET "refundedCents" = LEAST("depositPaidCents", "refundedCents" + ${amountCents}),
        "stripeRefundId" = ${refundId}, "updatedAt" = now()
    WHERE "id" = ${bookingId} AND ("stripeRefundId" IS NULL OR "stripeRefundId" <> ${refundId})`;
  return res === 1;
}

export async function setBookingOutcome(args: {
  tenantId: string;
  bookingId: string;
  status: "COMPLETED" | "NO_SHOW";
  now: Date;
}): Promise<Booking> {
  const db = forTenant(args.tenantId);
  const b = await db.booking.findUnique({ where: { id: args.bookingId } });
  if (!b) throw new NotFoundError("Booking");
  if (!canTransition(b.status, args.status)) {
    throw new InvalidStateError(`Cannot mark a ${b.status.toLowerCase()} booking as ${args.status.toLowerCase()}`);
  }
  if (b.startAt > args.now) throw new InvalidStateError("Outcome can only be recorded after the appointment starts");
  const res = await db.booking.updateMany({
    where: { id: b.id, status: b.status },
    data: { status: args.status },
  });
  if (res.count !== 1) throw new InvalidStateError("This booking was changed by someone else");
  return db.booking.findUniqueOrThrow({ where: { id: b.id } });
}

/**
 * Moves a confirmed booking to a new start time with the same staff member. Allowed only outside
 * the tenant's cancellation window (same policy as free cancellation). The exclusion constraint
 * still arbitrates conflicts; the availability check just gives a friendlier error earlier.
 */
export async function rescheduleBooking(args: {
  tenantId: string;
  bookingId: string;
  newStart: Date;
  now: Date;
  expectedTokenVersion?: number;
}): Promise<BookingWithRelations> {
  const db = forTenant(args.tenantId);
  const b = await db.booking.findUnique({ where: { id: args.bookingId }, include: bookingInclude });
  if (!b) throw new NotFoundError("Booking");
  if (args.expectedTokenVersion !== undefined && b.tokenVersion !== args.expectedTokenVersion) {
    throw new InvalidStateError("This link is no longer valid. Use the most recent email from the business.");
  }
  if (b.status !== "CONFIRMED") throw new InvalidStateError("Only confirmed bookings can be rescheduled");
  const cutoff = b.startAt.getTime() - b.tenant.cancellationWindowHours * 3_600_000;
  if (args.now.getTime() > cutoff) {
    throw new InvalidStateError("It's too late to reschedule online. Please contact the business.");
  }

  const localDate = toLocalDate(args.newStart, b.tenant.timezone);
  const loaded = await loadAvailabilityInput({
    tenant: b.tenant,
    serviceId: b.serviceId,
    staffId: b.staffId,
    fromDate: localDate,
    toDate: localDate,
    now: args.now,
    excludeBookingId: b.id,
  });
  if (!loaded || !computeSlots(loaded.input).some((s) => s.start.getTime() === args.newStart.getTime())) {
    throw new SlotUnavailableError();
  }

  const endAt = addMinutes(args.newStart, b.endAt.getTime() / 60_000 - b.startAt.getTime() / 60_000);
  const blockedUntil = addMinutes(endAt, (b.blockedUntil.getTime() - b.endAt.getTime()) / 60_000);
  try {
    const res = await db.booking.updateMany({
      where: { id: b.id, status: "CONFIRMED", tokenVersion: b.tokenVersion },
      data: { startAt: args.newStart, endAt, blockedUntil, tokenVersion: { increment: 1 } },
    });
    if (res.count !== 1) throw new InvalidStateError("This booking was changed by someone else");
  } catch (err) {
    if (isExclusionViolation(err)) throw new SlotUnavailableError();
    throw err;
  }
  return db.booking.findUniqueOrThrow({ where: { id: b.id }, include: bookingInclude });
}

export async function getBookingWithRelations(bookingId: string): Promise<BookingWithRelations | null> {
  return prisma.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
}
