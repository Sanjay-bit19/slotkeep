import { describe, expect, it } from "vitest";
import { checkBookingLimit, checkStaffLimit, effectivePlan, remainingBookings } from "../src/limits";

const now = new Date("2026-06-10T12:00:00Z");

describe("plan limits", () => {
  it("free plan allows exactly one active staff member", () => {
    expect(checkStaffLimit("FREE", 0)).toEqual({ ok: true });
    expect(checkStaffLimit("FREE", 1)).toEqual({ ok: false, code: "STAFF_LIMIT", limit: 1 });
  });

  it("free plan allows 50 bookings per month", () => {
    expect(checkBookingLimit("FREE", 49)).toEqual({ ok: true });
    expect(checkBookingLimit("FREE", 50)).toEqual({ ok: false, code: "BOOKING_LIMIT", limit: 50 });
    expect(remainingBookings("FREE", 45)).toBe(5);
    expect(remainingBookings("FREE", 80)).toBe(0);
  });

  it("pro plan is unlimited", () => {
    expect(checkStaffLimit("PRO", 500)).toEqual({ ok: true });
    expect(checkBookingLimit("PRO", 1_000_000)).toEqual({ ok: true });
  });

  describe("effectivePlan", () => {
    const pro = { plan: "PRO" as const, currentPeriodEnd: new Date("2026-07-01T00:00:00Z") };
    it.each([
      ["ACTIVE", "PRO"],
      ["TRIALING", "PRO"],
      ["PAST_DUE", "PRO"],
      ["INCOMPLETE", "FREE"],
      ["UNPAID", "FREE"],
      ["NONE", "FREE"],
    ] as const)("%s -> %s", (status, expected) => {
      expect(effectivePlan({ ...pro, subscriptionStatus: status }, now)).toBe(expected);
    });

    it("keeps PRO after cancellation until the paid period ends", () => {
      expect(effectivePlan({ ...pro, subscriptionStatus: "CANCELED" }, now)).toBe("PRO");
      expect(effectivePlan({ ...pro, subscriptionStatus: "CANCELED" }, new Date("2026-07-02T00:00:00Z"))).toBe("FREE");
      expect(effectivePlan({ ...pro, currentPeriodEnd: null, subscriptionStatus: "CANCELED" }, now)).toBe("FREE");
    });

    it("FREE is always FREE", () => {
      expect(effectivePlan({ plan: "FREE", subscriptionStatus: "ACTIVE", currentPeriodEnd: null }, now)).toBe("FREE");
    });
  });
});
