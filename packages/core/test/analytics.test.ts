import { describe, expect, it } from "vitest";
import { bookingsPerWeek, noShowRate, revenueSummary, type AnalyticsBooking } from "../src/analytics";

const row = (startAt: string, status: AnalyticsBooking["status"], dep = 1000, ref = 0, price = 5000): AnalyticsBooking => ({
  startAt: new Date(startAt),
  status,
  depositPaidCents: dep,
  refundedCents: ref,
  priceCents: price,
});

describe("analytics", () => {
  const now = new Date("2026-06-17T12:00:00Z"); // Wednesday
  const rows = [
    row("2026-06-15T15:00:00Z", "COMPLETED"),
    row("2026-06-16T15:00:00Z", "NO_SHOW"),
    row("2026-06-09T15:00:00Z", "CONFIRMED"),
    row("2026-06-09T16:00:00Z", "CANCELLED", 1000, 1000),
    row("2026-06-10T16:00:00Z", "CANCELLED", 0, 0), // expired hold
    row("2026-01-01T16:00:00Z", "COMPLETED"), // outside window
  ];

  it("buckets bookings by ISO week in the tenant zone with zero-filled weeks", () => {
    const weeks = bookingsPerWeek(rows, "America/New_York", 3, now);
    expect(weeks).toEqual([
      { weekStart: "2026-06-01", bookings: 0, depositRevenueCents: 0 },
      { weekStart: "2026-06-08", bookings: 1, depositRevenueCents: 1000 },
      { weekStart: "2026-06-15", bookings: 2, depositRevenueCents: 2000 },
    ]);
  });

  it("uses local week boundaries (Sunday night in NY is Monday in UTC)", () => {
    const weeks = bookingsPerWeek([row("2026-06-15T02:00:00Z", "CONFIRMED")], "America/New_York", 2, now);
    expect(weeks[0]).toMatchObject({ weekStart: "2026-06-08", bookings: 1 });
  });

  it("summarizes revenue", () => {
    expect(revenueSummary(rows)).toEqual({
      netDepositCents: 4000,
      refundedCents: 1000,
      completedServiceValueCents: 10000,
    });
  });

  it("computes the no-show rate over resolved appointments", () => {
    expect(noShowRate(rows)).toBeCloseTo(1 / 3);
    expect(noShowRate([row("2026-06-15T15:00:00Z", "CONFIRMED")])).toBeNull();
  });
});
