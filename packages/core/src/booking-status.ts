export const BOOKING_STATUSES = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * Statuses that occupy a staff member's time. Must match the WHERE clause of the
 * `booking_no_overlap` exclusion constraint in packages/db.
 */
export const BLOCKING_STATUSES: readonly BookingStatus[] = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "COMPLETED",
  "NO_SHOW",
];

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING_PAYMENT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CANCELLED", "COMPLETED", "NO_SHOW"],
  // Owners can correct a mis-click between the two terminal outcomes.
  COMPLETED: ["NO_SHOW"],
  NO_SHOW: ["COMPLETED"],
  // CANCELLED -> CONFIRMED is only legal for a late payment on an expired hold; that path goes
  // through `reinstate` explicitly and is not a user-facing transition.
  CANCELLED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isBlocking(status: BookingStatus): boolean {
  return BLOCKING_STATUSES.includes(status);
}

export const CANCEL_REASONS = ["HOLD_EXPIRED", "CUSTOMER", "OWNER", "PAYMENT_CONFLICT"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
