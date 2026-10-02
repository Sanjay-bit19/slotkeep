import { DateTime } from "luxon";
import type { BookingStatus } from "./booking-status";

export interface AnalyticsBooking {
  startAt: Date;
  status: BookingStatus;
  /** Deposit actually captured (0 if never paid). */
  depositPaidCents: number;
  refundedCents: number;
  priceCents: number;
}

export interface WeekBucket {
  /** Local date of the Monday that starts the ISO week. */
  weekStart: string;
  bookings: number;
  depositRevenueCents: number;
}

/** Bookings that represent real demand: excludes cancelled holds and cancellations. */
function countsAsBooking(status: BookingStatus): boolean {
  return status === "CONFIRMED" || status === "COMPLETED" || status === "NO_SHOW";
}

/**
 * Buckets bookings into the last `weeks` ISO weeks (ending with the week containing `now`) by
 * appointment start in the tenant timezone. Weeks with no bookings are included as zeros.
 */
export function bookingsPerWeek(
  rows: AnalyticsBooking[],
  tz: string,
  weeks: number,
  now: Date,
): WeekBucket[] {
  const current = DateTime.fromJSDate(now, { zone: tz }).startOf("week");
  const buckets = new Map<string, WeekBucket>();
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = current.minus({ weeks: i }).toISODate()!;
    buckets.set(ws, { weekStart: ws, bookings: 0, depositRevenueCents: 0 });
  }
  for (const r of rows) {
    const ws = DateTime.fromJSDate(r.startAt, { zone: tz }).startOf("week").toISODate()!;
    const bucket = buckets.get(ws);
    if (!bucket) continue;
    if (countsAsBooking(r.status)) bucket.bookings += 1;
    bucket.depositRevenueCents += netDeposit(r);
  }
  return [...buckets.values()];
}

function netDeposit(r: AnalyticsBooking): number {
  return Math.max(0, r.depositPaidCents - r.refundedCents);
}

export interface RevenueSummary {
  /** Deposits captured minus refunds. Money actually received online. */
  netDepositCents: number;
  refundedCents: number;
  /** Full service price of completed appointments (deposit + balance collected in person). */
  completedServiceValueCents: number;
}

export function revenueSummary(rows: AnalyticsBooking[]): RevenueSummary {
  let net = 0;
  let refunded = 0;
  let completed = 0;
  for (const r of rows) {
    net += netDeposit(r);
    refunded += r.refundedCents;
    if (r.status === "COMPLETED") completed += r.priceCents;
  }
  return { netDepositCents: net, refundedCents: refunded, completedServiceValueCents: completed };
}

/**
 * No-show rate over appointments whose outcome is known (COMPLETED or NO_SHOW). Returns null when
 * there are none, so the UI can show "n/a" instead of a misleading 0%.
 */
export function noShowRate(rows: AnalyticsBooking[]): number | null {
  let noShows = 0;
  let resolved = 0;
  for (const r of rows) {
    if (r.status === "NO_SHOW") {
      noShows++;
      resolved++;
    } else if (r.status === "COMPLETED") resolved++;
  }
  return resolved === 0 ? null : noShows / resolved;
}
