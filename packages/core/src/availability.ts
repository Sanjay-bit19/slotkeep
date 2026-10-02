import { addMinutes, eachLocalDate, localWeekday, wallTimeToUtc } from "./time";

/**
 * The availability engine. Pure and deterministic: same input, same output, no clock or I/O.
 * The caller passes `now` and every busy interval it loaded from the database.
 */

export interface WeeklyRule {
  /** ISO weekday: 1 = Monday ... 7 = Sunday, interpreted in the tenant timezone. */
  weekday: number;
  /** Minutes after local midnight, inclusive. */
  startMinute: number;
  /** Minutes after local midnight, exclusive. 1440 = end of day. */
  endMinute: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface StaffSchedule {
  staffId: string;
  weekly: WeeklyRule[];
  timeOff: Interval[];
  /**
   * Existing bookings that still hold time. `end` must already include that booking's buffer,
   * i.e. it is the booking's `blockedUntil`, not its `endAt`.
   */
  busy: Interval[];
}

export interface AvailabilityInput {
  timezone: string;
  /** Inclusive local date range, YYYY-MM-DD. */
  fromDate: string;
  toDate: string;
  durationMin: number;
  bufferMin: number;
  staff: StaffSchedule[];
  now: Date;
  /** Slot start granularity in minutes, aligned to the start of each working window. */
  stepMin?: number;
  /** Earliest bookable start is `now + minLeadMin`. */
  minLeadMin?: number;
}

export interface Slot {
  start: Date;
  /** End of the service itself (excludes buffer). */
  end: Date;
  /** Staff members who can take this slot, sorted for determinism. */
  staffIds: string[];
}

export const MAX_RANGE_DAYS = 62;

export function validateAvailabilityInput(input: AvailabilityInput): void {
  const { durationMin, bufferMin } = input;
  const step = input.stepMin ?? 15;
  if (!Number.isInteger(durationMin) || durationMin <= 0) throw new RangeError("durationMin must be a positive integer");
  if (!Number.isInteger(bufferMin) || bufferMin < 0) throw new RangeError("bufferMin must be a non-negative integer");
  if (!Number.isInteger(step) || step <= 0) throw new RangeError("stepMin must be a positive integer");
  if (input.fromDate > input.toDate) throw new RangeError("fromDate must be <= toDate");
  for (const s of input.staff) {
    for (const r of s.weekly) {
      if (!Number.isInteger(r.weekday) || r.weekday < 1 || r.weekday > 7) throw new RangeError(`Invalid weekday ${r.weekday}`);
      if (!(r.startMinute >= 0 && r.endMinute <= 1440 && r.startMinute < r.endMinute)) {
        throw new RangeError(`Invalid weekly rule ${r.startMinute}-${r.endMinute}`);
      }
    }
  }
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Merges overlapping or touching [start, end) minute ranges. */
export function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Working windows (UTC instants) for one staff member on one local date. */
export function workingWindows(staff: StaffSchedule, date: string, timezone: string): Interval[] {
  const weekday = localWeekday(date, timezone);
  const ranges = mergeRanges(
    staff.weekly.filter((r) => r.weekday === weekday).map((r) => [r.startMinute, r.endMinute]),
  );
  const windows: Interval[] = [];
  for (const [startMin, endMin] of ranges) {
    const start = wallTimeToUtc(date, startMin, timezone);
    const end = wallTimeToUtc(date, endMin, timezone);
    // Can collapse to empty when the whole window sits inside a DST gap.
    if (end > start) windows.push({ start, end });
  }
  return windows;
}

/** Open slot starts for a single staff member across the input date range. */
export function staffSlots(input: AvailabilityInput, staff: StaffSchedule): Date[] {
  const step = input.stepMin ?? 15;
  const earliest = input.now.getTime() + (input.minLeadMin ?? 0) * 60_000;
  const blockMs = (input.durationMin + input.bufferMin) * 60_000;
  const blocked = [...staff.busy, ...staff.timeOff]
    .map((i) => [i.start.getTime(), i.end.getTime()] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  const out: Date[] = [];
  for (const date of eachLocalDate(input.fromDate, input.toDate)) {
    for (const w of workingWindows(staff, date, input.timezone)) {
      const wEnd = w.end.getTime();
      // The whole blocked footprint (service + buffer) must fit inside working hours, so a
      // staff member is never booked into cleanup time after closing.
      for (let t = w.start.getTime(); t + blockMs <= wEnd; t += step * 60_000) {
        if (t < earliest) continue;
        const tEnd = t + blockMs;
        let free = true;
        for (const [bs, be] of blocked) {
          if (bs >= tEnd) break;
          if (overlaps(t, tEnd, bs, be)) {
            free = false;
            break;
          }
        }
        if (free) out.push(new Date(t));
      }
    }
  }
  return out;
}

/**
 * Computes open slots across all given staff. Slots with the same start instant are merged and
 * list every staff member who can take them (used for "any staff" booking).
 */
export function computeSlots(input: AvailabilityInput): Slot[] {
  validateAvailabilityInput(input);
  const days = eachLocalDate(input.fromDate, input.toDate).length;
  if (days > MAX_RANGE_DAYS) throw new RangeError(`Date range exceeds ${MAX_RANGE_DAYS} days`);

  const byStart = new Map<number, Set<string>>();
  for (const staff of input.staff) {
    for (const start of staffSlots(input, staff)) {
      const key = start.getTime();
      let set = byStart.get(key);
      if (!set) byStart.set(key, (set = new Set()));
      set.add(staff.staffId);
    }
  }
  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, ids]) => ({
      start: new Date(ms),
      end: addMinutes(new Date(ms), input.durationMin),
      staffIds: [...ids].sort(),
    }));
}

/** True if `start` is an open slot for `staffId` under the given input. */
export function isSlotAvailable(input: AvailabilityInput, staffId: string, start: Date): boolean {
  validateAvailabilityInput(input);
  const staff = input.staff.find((s) => s.staffId === staffId);
  if (!staff) return false;
  return staffSlots(input, staff).some((d) => d.getTime() === start.getTime());
}

/**
 * Picks a staff member for an "any staff" booking: the candidate with the fewest bookings that
 * day, ties broken by id so the choice is deterministic.
 */
export function pickStaff(candidates: string[], bookingsToday: Record<string, number>): string | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (bookingsToday[a] ?? 0) - (bookingsToday[b] ?? 0) || a.localeCompare(b))[0]!;
}
