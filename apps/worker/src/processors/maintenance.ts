import { localHour, toLocalDate } from "@slotkeep/core";
import { expireOverdueHolds, prisma } from "@slotkeep/db";
import {
  getQueue,
  paymentGateway,
  QUEUE_NAMES,
  type EmailJob,
  type Logger,
  type MaintenanceJob,
} from "@slotkeep/infra";

export const DAILY_SUMMARY_LOCAL_HOUR = 7;

export async function processMaintenanceJob(data: MaintenanceJob, log: Logger, now = new Date()) {
  if (data.kind === "sweep-holds") return sweepHolds(log, now);
  return fanOutDailySummaries(log, now);
}

/**
 * Safety net for lost delayed jobs (e.g. Redis flushed): releases any overdue holds every minute.
 * Normal expiry is the per-booking delayed job; this just bounds the damage if one goes missing.
 */
export async function sweepHolds(log: Logger, now: Date) {
  const ids = await expireOverdueHolds(now);
  if (ids.length) {
    const rows = await prisma.booking.findMany({
      where: { id: { in: ids } },
      select: { stripeCheckoutSessionId: true },
    });
    for (const r of rows) {
      if (r.stripeCheckoutSessionId)
        await paymentGateway()
          .expireCheckout(r.stripeCheckoutSessionId)
          .catch(() => undefined);
    }
    log.warn(
      { count: ids.length },
      "sweeper released overdue holds (delayed jobs may have been lost)",
    );
  }
  return { released: ids.length };
}

/**
 * Runs hourly. Each tenant gets its summary when it's 7am on *their* wall clock, so a single
 * cron handles every timezone (including DST shifts) without per-tenant schedules.
 */
export async function fanOutDailySummaries(log: Logger, now: Date) {
  const tenants = await prisma.tenant.findMany({ select: { id: true, timezone: true } });
  const due = tenants.filter((t) => localHour(now, t.timezone) === DAILY_SUMMARY_LOCAL_HOUR);
  const q = getQueue<EmailJob>(QUEUE_NAMES.email);
  for (const t of due) {
    const localDate = toLocalDate(now, t.timezone);
    await q.add(
      "daily-summary",
      { kind: "daily-summary", tenantId: t.id, localDate },
      { jobId: `daily-summary-${t.id}-${localDate}` },
    );
  }
  log.info({ tenants: tenants.length, due: due.length }, "daily summaries fanned out");
  return { enqueued: due.length };
}
