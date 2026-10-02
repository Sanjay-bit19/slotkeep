import {
  addDaysToLocalDate,
  bookingFiltersSchema,
  bookingsPerWeek,
  localDayBounds,
  noShowRate,
  revenueSummary,
} from "@slotkeep/core";
import { loadAnalyticsRows, type BookingStatus, type Prisma } from "@slotkeep/db";
import { DateTime } from "luxon";
import type { TenantContext } from "./authz";

export const PAGE_SIZE = 25;

export async function calendarBookings(ctx: TenantContext, fromDate: string, toDate: string) {
  const start = localDayBounds(fromDate, ctx.tenant.timezone).start;
  const end = localDayBounds(toDate, ctx.tenant.timezone).end;
  return ctx.db.booking.findMany({
    where: {
      startAt: { gte: start, lt: end },
      status: { in: ["PENDING_PAYMENT", "CONFIRMED", "COMPLETED", "NO_SHOW"] },
    },
    include: {
      customer: { select: { name: true } },
      service: { select: { name: true } },
      staff: { select: { id: true, name: true } },
    },
    orderBy: { startAt: "asc" },
  });
}

export async function listBookings(
  ctx: TenantContext,
  rawFilters: Record<string, string | undefined>,
) {
  const f = bookingFiltersSchema.parse(rawFilters);
  const where: Prisma.BookingWhereInput = {};
  if (f.status) where.status = f.status as BookingStatus;
  if (f.staffId) where.staffId = f.staffId;
  if (f.from || f.to) {
    where.startAt = {
      ...(f.from ? { gte: localDayBounds(f.from, ctx.tenant.timezone).start } : {}),
      ...(f.to ? { lt: localDayBounds(f.to, ctx.tenant.timezone).end } : {}),
    };
  }
  if (f.q) {
    where.customer = {
      OR: [
        { name: { contains: f.q, mode: "insensitive" } },
        { email: { contains: f.q, mode: "insensitive" } },
      ],
    };
  }
  const [total, rows] = await Promise.all([
    ctx.db.booking.count({ where }),
    ctx.db.booking.findMany({
      where,
      include: {
        customer: { select: { name: true, email: true } },
        service: { select: { name: true } },
        staff: { select: { name: true } },
      },
      orderBy: { startAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { filters: f, total, rows, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function bookingDetail(ctx: TenantContext, id: string) {
  return ctx.db.booking.findUnique({
    where: { id },
    include: { customer: true, service: true, staff: { select: { id: true, name: true } } },
  });
}

export async function analyticsFor(ctx: TenantContext, weeks = 12, now = new Date()) {
  const tz = ctx.tenant.timezone;
  const firstWeek = DateTime.fromJSDate(now, { zone: tz })
    .startOf("week")
    .minus({ weeks: weeks - 1 });
  const since = firstWeek.toUTC().toJSDate();
  const until = DateTime.fromJSDate(now, { zone: tz })
    .startOf("week")
    .plus({ weeks: 1 })
    .toUTC()
    .toJSDate();
  const rows = await loadAnalyticsRows(ctx.tenant.id, since, until);
  return {
    weeks: bookingsPerWeek(rows, tz, weeks, now),
    revenue: revenueSummary(rows),
    noShowRate: noShowRate(rows),
    totalBookings: rows.filter(
      (r) => r.status === "CONFIRMED" || r.status === "COMPLETED" || r.status === "NO_SHOW",
    ).length,
  };
}

export function todayLocal(tz: string, now = new Date()): string {
  return DateTime.fromJSDate(now, { zone: tz }).toISODate()!;
}

export { addDaysToLocalDate };
