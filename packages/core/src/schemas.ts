import { z } from "zod";
import { MIN_CHARGE_CENTS } from "./pricing";
import { ISO_DATE_RE, isValidTimeZone } from "./time";

export {
  createBookingSchema,
  customerDetailsSchema,
  type CreateBookingInput,
} from "./booking-schemas";

/**
 * Zod schemas shared by client forms and server handlers. The server always re-parses, so a
 * client that skips validation gains nothing.
 */

export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "b",
  "billing",
  "dashboard",
  "dev",
  "help",
  "login",
  "logout",
  "m",
  "onboarding",
  "pricing",
  "settings",
  "signin",
  "signup",
  "static",
  "support",
  "www",
]);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters")
  .max(40, "At most 40 characters")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Lowercase letters, numbers and dashes only")
  .refine((s) => !RESERVED_SLUGS.has(s), "This slug is reserved");

export const timezoneSchema = z.string().refine(isValidTimeZone, "Unknown timezone");

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #4f46e5");

export const localDateSchema = z.string().regex(ISO_DATE_RE, "Use YYYY-MM-DD");

const centsSchema = z.number().int().nonnegative().max(10_000_000);

export const onboardingSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema,
  timezone: timezoneSchema,
  brandColor: hexColorSchema.default("#4f46e5"),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const tenantSettingsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  timezone: timezoneSchema,
  brandColor: hexColorSchema,
  cancellationWindowHours: z.number().int().min(0).max(168),
});

export const serviceSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional().default(""),
    durationMin: z.number().int().min(5).max(480).multipleOf(5),
    bufferMin: z.number().int().min(0).max(120).multipleOf(5),
    priceCents: centsSchema,
    depositCents: centsSchema,
    active: z.boolean().default(true),
  })
  .refine((s) => s.depositCents <= s.priceCents, {
    message: "Deposit cannot exceed price",
    path: ["depositCents"],
  })
  .refine((s) => s.depositCents === 0 || s.depositCents >= MIN_CHARGE_CENTS, {
    message: `Deposit must be 0 or at least ${MIN_CHARGE_CENTS} cents`,
    path: ["depositCents"],
  });
export type ServiceInput = z.infer<typeof serviceSchema>;

export const weeklyRuleSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((r) => r.startMinute < r.endMinute, { message: "End must be after start" });

export const staffSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z
    .union([z.email(), z.literal("")])
    .optional()
    .default(""),
  active: z.boolean().default(true),
  serviceIds: z.array(z.string().min(1)).default([]),
  weekly: z.array(weeklyRuleSchema).max(50).default([]),
});
export type StaffInput = z.infer<typeof staffSchema>;

export const timeOffSchema = z
  .object({
    staffId: z.string().min(1),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    reason: z.string().trim().max(200).optional().default(""),
  })
  .refine((t) => t.endAt > t.startAt, { message: "End must be after start", path: ["endAt"] });

export const availabilityQuerySchema = z
  .object({
    serviceId: z.string().min(1),
    staffId: z.string().min(1).optional(),
    from: localDateSchema,
    to: localDateSchema,
  })
  .refine((q) => q.from <= q.to, { message: "from must be <= to", path: ["to"] });

export const rescheduleSchema = z.object({
  token: z.string().min(10),
  start: z.iso.datetime({ offset: true }),
});

export const bookingFiltersSchema = z.object({
  status: z.enum(["PENDING_PAYMENT", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]).optional(),
  staffId: z.string().optional(),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const memberInviteSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(["OWNER", "STAFF"]),
});

/** Parses "HH:MM" into minutes after midnight; "24:00" is allowed as end of day. */
export function parseTimeOfDay(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new RangeError(`Invalid time: ${value}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) throw new RangeError(`Invalid time: ${value}`);
  return h * 60 + min;
}

export function formatTimeOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
