import {
  addDaysToLocalDate,
  computeSlots,
  localDayBounds,
  type AvailabilityInput,
  type Slot,
  type StaffSchedule,
} from "@slotkeep/core";
import type { Service, Tenant } from "@prisma/client";
import { forTenant } from "./tenant";

export const SLOT_STEP_MIN = 15;
export const MIN_LEAD_MIN = 60;

export interface AvailabilityRequest {
  tenant: Pick<Tenant, "id" | "timezone">;
  serviceId: string;
  /** Restrict to one staff member; omit for "any". */
  staffId?: string;
  fromDate: string;
  toDate: string;
  now: Date;
  /** Booking id to ignore (when rescheduling, a booking must not block itself). */
  excludeBookingId?: string;
}

export interface LoadedAvailability {
  service: Service;
  input: AvailabilityInput;
}

/**
 * Loads everything the pure engine needs for one service over a local date range: eligible
 * staff, their weekly rules, time off, and existing bookings that still hold time.
 *
 * Expired holds (PENDING_PAYMENT past holdExpiresAt) are ignored here even if the expiry job
 * has not run yet, so a stalled worker never shows phantom unavailability.
 */
export async function loadAvailabilityInput(
  req: AvailabilityRequest,
): Promise<LoadedAvailability | null> {
  const db = forTenant(req.tenant.id);
  const service = await db.service.findFirst({ where: { id: req.serviceId, active: true } });
  if (!service) return null;

  const staff = await db.staffMember.findMany({
    where: {
      active: true,
      services: { some: { serviceId: service.id } },
      ...(req.staffId ? { id: req.staffId } : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const staffIds = staff.map((s) => s.id);

  // Pad the window by a day on each side so bookings/time off crossing local midnight count.
  const rangeStart = localDayBounds(
    addDaysToLocalDate(req.fromDate, -1),
    req.tenant.timezone,
  ).start;
  const rangeEnd = localDayBounds(addDaysToLocalDate(req.toDate, 1), req.tenant.timezone).end;

  const [rules, timeOff, bookings] = await Promise.all([
    db.weeklyAvailability.findMany({ where: { staffId: { in: staffIds } } }),
    db.timeOff.findMany({
      where: { staffId: { in: staffIds }, startAt: { lt: rangeEnd }, endAt: { gt: rangeStart } },
    }),
    db.booking.findMany({
      where: {
        staffId: { in: staffIds },
        startAt: { lt: rangeEnd },
        blockedUntil: { gt: rangeStart },
        ...(req.excludeBookingId ? { id: { not: req.excludeBookingId } } : {}),
        OR: [
          { status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] } },
          { status: "PENDING_PAYMENT", holdExpiresAt: { gt: req.now } },
        ],
      },
      select: { staffId: true, startAt: true, blockedUntil: true },
    }),
  ]);

  const schedules: StaffSchedule[] = staffIds.map((id) => ({
    staffId: id,
    weekly: rules
      .filter((r) => r.staffId === id)
      .map((r) => ({ weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute })),
    timeOff: timeOff
      .filter((t) => t.staffId === id)
      .map((t) => ({ start: t.startAt, end: t.endAt })),
    busy: bookings
      .filter((b) => b.staffId === id)
      .map((b) => ({ start: b.startAt, end: b.blockedUntil })),
  }));

  return {
    service,
    input: {
      timezone: req.tenant.timezone,
      fromDate: req.fromDate,
      toDate: req.toDate,
      durationMin: service.durationMin,
      bufferMin: service.bufferMin,
      staff: schedules,
      now: req.now,
      stepMin: SLOT_STEP_MIN,
      minLeadMin: MIN_LEAD_MIN,
    },
  };
}

export async function getAvailableSlots(req: AvailabilityRequest): Promise<Slot[] | null> {
  const loaded = await loadAvailabilityInput(req);
  return loaded ? computeSlots(loaded.input) : null;
}
