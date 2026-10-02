export const PLANS = ["FREE", "PRO"] as const;
export type Plan = (typeof PLANS)[number];

export const SUBSCRIPTION_STATUSES = [
  "NONE",
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
  "CANCELED",
  "INCOMPLETE",
  "UNPAID",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface PlanLimits {
  maxActiveStaff: number;
  maxBookingsPerMonth: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: { maxActiveStaff: 1, maxBookingsPerMonth: 50 },
  PRO: { maxActiveStaff: Number.POSITIVE_INFINITY, maxBookingsPerMonth: Number.POSITIVE_INFINITY },
};

export interface BillingState {
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: Date | null;
}

/**
 * The plan a tenant is entitled to right now. The stored `plan` is what they bought; whether it
 * applies depends on subscription health:
 * - ACTIVE / TRIALING: paid plan applies.
 * - PAST_DUE: paid plan applies (Stripe is retrying the card; don't punish a failed renewal).
 * - CANCELED: paid plan applies until the end of the period already paid for.
 * - anything else: FREE.
 */
export function effectivePlan(state: BillingState, now: Date): Plan {
  if (state.plan === "FREE") return "FREE";
  switch (state.subscriptionStatus) {
    case "ACTIVE":
    case "TRIALING":
    case "PAST_DUE":
      return state.plan;
    case "CANCELED":
      return state.currentPeriodEnd && state.currentPeriodEnd > now ? state.plan : "FREE";
    default:
      return "FREE";
  }
}

export type LimitResult =
  { ok: true } | { ok: false; code: "STAFF_LIMIT" | "BOOKING_LIMIT"; limit: number };

export function checkStaffLimit(plan: Plan, activeStaffCount: number): LimitResult {
  const limit = PLAN_LIMITS[plan].maxActiveStaff;
  return activeStaffCount < limit ? { ok: true } : { ok: false, code: "STAFF_LIMIT", limit };
}

/** `monthCount` is the number of bookings already counted against this month's quota. */
export function checkBookingLimit(plan: Plan, monthCount: number): LimitResult {
  const limit = PLAN_LIMITS[plan].maxBookingsPerMonth;
  return monthCount < limit ? { ok: true } : { ok: false, code: "BOOKING_LIMIT", limit };
}

export function remainingBookings(plan: Plan, monthCount: number): number {
  return Math.max(0, PLAN_LIMITS[plan].maxBookingsPerMonth - monthCount);
}
