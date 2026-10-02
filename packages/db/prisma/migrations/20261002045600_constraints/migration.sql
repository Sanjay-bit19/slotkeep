-- Hand-written constraints that Prisma's schema language cannot express.
-- See docs/adr/0001-double-booking-exclusion-constraint.md.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Double-booking prevention. No two time-holding bookings for the same staff member may have
-- overlapping [startAt, blockedUntil) ranges. blockedUntil = endAt + buffer, so buffers are
-- protected too. The WHERE clause must match BLOCKING_STATUSES in packages/core.
ALTER TABLE "Booking"
  ADD CONSTRAINT "booking_no_overlap"
  EXCLUDE USING gist (
    "staffId" WITH =,
    tstzrange("startAt", "blockedUntil", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'));

ALTER TABLE "Booking"
  ADD CONSTRAINT "booking_time_order" CHECK ("endAt" > "startAt" AND "blockedUntil" >= "endAt"),
  ADD CONSTRAINT "booking_money_nonneg" CHECK (
    "priceCents" >= 0 AND "depositCents" >= 0 AND "depositPaidCents" >= 0 AND "refundedCents" >= 0
  ),
  ADD CONSTRAINT "booking_refund_le_paid" CHECK ("refundedCents" <= "depositPaidCents"),
  ADD CONSTRAINT "booking_hold_has_expiry" CHECK ("status" <> 'PENDING_PAYMENT' OR "holdExpiresAt" IS NOT NULL);

ALTER TABLE "Service"
  ADD CONSTRAINT "service_duration_pos" CHECK ("durationMin" > 0 AND "bufferMin" >= 0),
  ADD CONSTRAINT "service_money" CHECK ("priceCents" >= 0 AND "depositCents" >= 0 AND "depositCents" <= "priceCents");

ALTER TABLE "WeeklyAvailability"
  ADD CONSTRAINT "weekly_valid" CHECK (
    "weekday" BETWEEN 1 AND 7 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute"
  );

ALTER TABLE "TimeOff" ADD CONSTRAINT "timeoff_order" CHECK ("endAt" > "startAt");

ALTER TABLE "Tenant" ADD CONSTRAINT "tenant_cancel_window" CHECK ("cancellationWindowHours" >= 0);

-- Lets the hold sweeper find expired holds without scanning confirmed bookings.
CREATE INDEX "booking_pending_holds" ON "Booking" ("holdExpiresAt") WHERE "status" = 'PENDING_PAYMENT';
