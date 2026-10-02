import { PLAN_LIMITS, remainingBookings } from "@slotkeep/core";
import { countMonthlyBookings, DomainError, prisma } from "@slotkeep/db";
import { env, paymentGateway } from "@slotkeep/infra";
import type { TenantContext } from "../authz";

export async function usageFor(ctx: TenantContext) {
  const [activeStaff, monthBookings] = await Promise.all([
    ctx.db.staffMember.count({ where: { active: true } }),
    countMonthlyBookings(prisma, ctx.tenant.id, ctx.tenant.timezone, new Date()),
  ]);
  const limits = PLAN_LIMITS[ctx.plan];
  return {
    plan: ctx.plan,
    activeStaff,
    monthBookings,
    staffLimit: Number.isFinite(limits.maxActiveStaff) ? limits.maxActiveStaff : null,
    bookingLimit: Number.isFinite(limits.maxBookingsPerMonth) ? limits.maxBookingsPerMonth : null,
    bookingsRemaining: Number.isFinite(limits.maxBookingsPerMonth)
      ? remainingBookings(ctx.plan, monthBookings)
      : null,
  };
}

export async function startUpgrade(ctx: TenantContext): Promise<string> {
  if (ctx.plan === "PRO") throw new DomainError("ALREADY_PRO", "You're already on Pro", 409);
  const base = `${env().APP_URL}/dashboard/${ctx.tenant.slug}/billing`;
  const session = await paymentGateway().createSubscriptionCheckout({
    tenantId: ctx.tenant.id,
    customerId: ctx.tenant.stripeCustomerId,
    email: ctx.user.email,
    successUrl: `${base}?upgraded=1`,
    cancelUrl: base,
  });
  return session.url;
}

export async function openBillingPortal(ctx: TenantContext): Promise<string> {
  if (!ctx.tenant.stripeCustomerId)
    throw new DomainError("NO_CUSTOMER", "No billing account yet", 400);
  const portal = await paymentGateway().createBillingPortal({
    customerId: ctx.tenant.stripeCustomerId,
    returnUrl: `${env().APP_URL}/dashboard/${ctx.tenant.slug}/billing`,
  });
  return portal.url;
}
