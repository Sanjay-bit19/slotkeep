import { formatInTimeZone, localDayBounds } from "@slotkeep/core";
import { forTenant, prisma } from "@slotkeep/db";
import {
  dailySummaryEmail,
  env,
  sendBookingEmail,
  sendEmail,
  type EmailJob,
  type Logger,
} from "@slotkeep/infra";

export async function processEmailJob(data: EmailJob, log: Logger): Promise<unknown> {
  if (data.kind === "daily-summary") return sendDailySummary(data.tenantId, data.localDate, log);
  const res = await sendBookingEmail(data.kind, data.bookingId, { refundCents: data.refundCents });
  log.info(
    { kind: data.kind, bookingId: data.bookingId, status: res.status },
    "booking email processed",
  );
  return res;
}

/** Morning summary to every owner: today's confirmed appointments in the tenant timezone. */
export async function sendDailySummary(tenantId: string, localDate: string, log: Logger) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { status: "obsolete" };
  const db = forTenant(tenant.id);
  const { start, end } = localDayBounds(localDate, tenant.timezone);
  const [bookings, owners] = await Promise.all([
    db.booking.findMany({
      where: { startAt: { gte: start, lt: end }, status: "CONFIRMED" },
      include: {
        customer: { select: { name: true } },
        service: { select: { name: true } },
        staff: { select: { name: true } },
      },
      orderBy: { startAt: "asc" },
    }),
    db.membership.findMany({
      where: { role: "OWNER" },
      include: { user: { select: { email: true } } },
    }),
  ]);
  const rendered = dailySummaryEmail({
    businessName: tenant.name,
    brandColor: tenant.brandColor,
    timezone: tenant.timezone,
    localDate: formatInTimeZone(start, tenant.timezone, "cccc, LLLL d"),
    dashboardUrl: `${env().APP_URL}/dashboard/${tenant.slug}/calendar?view=day&date=${localDate}`,
    bookings: bookings.map((b) => ({
      startAt: b.startAt,
      customerName: b.customer.name,
      serviceName: b.service.name,
      staffName: b.staff.name,
    })),
  });
  for (const o of owners) {
    await sendEmail({
      ...rendered,
      to: o.user.email,
      template: "daily-summary",
      tenantId: tenant.id,
      dedupeKey: `summary:${tenant.id}:${localDate}:${o.user.email}`,
    });
  }
  log.info(
    { tenantId, localDate, owners: owners.length, bookings: bookings.length },
    "daily summary sent",
  );
  return { status: "sent", recipients: owners.length };
}
