import type { AnalyticsBooking } from "@slotkeep/core";
import { forTenant } from "./tenant";

export async function loadAnalyticsRows(
  tenantId: string,
  since: Date,
  until: Date,
): Promise<AnalyticsBooking[]> {
  return forTenant(tenantId).booking.findMany({
    where: { startAt: { gte: since, lt: until } },
    select: {
      startAt: true,
      status: true,
      depositPaidCents: true,
      refundedCents: true,
      priceCents: true,
    },
  });
}
