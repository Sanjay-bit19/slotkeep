import { describe, expect, it } from "vitest";
import { canTransition, isBlocking } from "../src/booking-status";
import {
  availabilityQuerySchema,
  createBookingSchema,
  formatTimeOfDay,
  onboardingSchema,
  parseTimeOfDay,
  serviceSchema,
  slugSchema,
  staffSchema,
  timeOffSchema,
  weeklyRuleSchema,
} from "../src/schemas";

describe("booking status machine", () => {
  it("allows the normal lifecycle", () => {
    expect(canTransition("PENDING_PAYMENT", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "COMPLETED")).toBe(true);
    expect(canTransition("CONFIRMED", "NO_SHOW")).toBe(true);
    expect(canTransition("NO_SHOW", "COMPLETED")).toBe(true);
  });

  it("forbids illegal transitions", () => {
    expect(canTransition("CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransition("PENDING_PAYMENT", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "CANCELLED")).toBe(false);
  });

  it("knows which statuses hold time", () => {
    expect(isBlocking("PENDING_PAYMENT")).toBe(true);
    expect(isBlocking("CANCELLED")).toBe(false);
  });
});

describe("schemas", () => {
  it("normalizes and validates slugs", () => {
    expect(slugSchema.parse("  My-Salon ")).toBe("my-salon");
    expect(slugSchema.safeParse("admin").success).toBe(false);
    expect(slugSchema.safeParse("-bad").success).toBe(false);
    expect(slugSchema.safeParse("ab").success).toBe(false);
    expect(slugSchema.safeParse("has space").success).toBe(false);
  });

  it("validates onboarding with timezone", () => {
    expect(onboardingSchema.parse({ name: "Shear Bliss", slug: "shear-bliss", timezone: "America/Chicago" }).brandColor).toBe("#4f46e5");
    expect(onboardingSchema.safeParse({ name: "X Y", slug: "xyz", timezone: "Nowhere/Land" }).success).toBe(false);
  });

  it("validates services: deposit <= price, minimum deposit, 5-minute granularity", () => {
    const ok = { name: "Cut", durationMin: 45, bufferMin: 15, priceCents: 5000, depositCents: 1000 };
    expect(serviceSchema.safeParse(ok).success).toBe(true);
    expect(serviceSchema.safeParse({ ...ok, depositCents: 6000 }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...ok, depositCents: 20 }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...ok, durationMin: 47 }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...ok, priceCents: 10.5 }).success).toBe(false);
  });

  it("validates staff, weekly rules, and time off", () => {
    expect(staffSchema.parse({ name: "Ana" })).toMatchObject({ email: "", weekly: [], serviceIds: [] });
    expect(weeklyRuleSchema.safeParse({ weekday: 1, startMinute: 600, endMinute: 540 }).success).toBe(false);
    expect(timeOffSchema.safeParse({ staffId: "s", startAt: "2026-06-10T10:00:00Z", endAt: "2026-06-10T09:00:00Z" }).success).toBe(false);
  });

  it("validates booking requests", () => {
    const parsed = createBookingSchema.parse({
      serviceId: "svc",
      start: "2026-06-10T13:00:00.000Z",
      name: "Jo Doe",
      email: "Jo@Example.com",
    });
    expect(parsed.email).toBe("jo@example.com");
    expect(createBookingSchema.safeParse({ serviceId: "svc", start: "tomorrow", name: "Jo", email: "jo@x.co" }).success).toBe(false);
    expect(createBookingSchema.safeParse({ serviceId: "svc", start: "2026-06-10T13:00:00Z", name: "Jo", email: "jo@x.co", phone: "<script>" }).success).toBe(false);
  });

  it("validates availability queries", () => {
    expect(availabilityQuerySchema.safeParse({ serviceId: "s", from: "2026-06-11", to: "2026-06-10" }).success).toBe(false);
  });

  it("parses and formats time of day", () => {
    expect(parseTimeOfDay("09:30")).toBe(570);
    expect(parseTimeOfDay("24:00")).toBe(1440);
    expect(() => parseTimeOfDay("24:30")).toThrow();
    expect(() => parseTimeOfDay("9:30")).toThrow();
    expect(() => parseTimeOfDay("10:60")).toThrow();
    expect(formatTimeOfDay(570)).toBe("09:30");
  });
});
