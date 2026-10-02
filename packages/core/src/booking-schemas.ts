import { z } from "zod";

/**
 * Booking request schemas. Kept free of Luxon/node imports so the public booking widget can
 * import them in the browser: the exact same rules run client-side and server-side.
 */

export const customerDetailsSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(80),
  email: z
    .email("Please enter a valid email")
    .max(254)
    .transform((e) => e.toLowerCase()),
  phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^[+()\d\s.-]*$/, "Digits, spaces and + ( ) - only")
    .optional()
    .default(""),
  notes: z.string().trim().max(500).optional().default(""),
});

export const createBookingSchema = customerDetailsSchema.extend({
  serviceId: z.string().min(1),
  /** Omitted or "any" means the server picks a staff member. */
  staffId: z.string().min(1).optional(),
  start: z.iso.datetime({ offset: true }),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
