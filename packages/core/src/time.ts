import { DateTime, IANAZone } from "luxon";

/**
 * Time helpers. Rule of the codebase: every instant is a UTC `Date` until it reaches an edge
 * (UI rendering, email copy, or interpreting a tenant's wall-clock schedule). These helpers are
 * the only place wall-clock <-> instant conversion happens.
 */

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTimeZone(tz: string): boolean {
  return typeof tz === "string" && tz.length > 0 && IANAZone.isValidZone(tz);
}

function parseLocalDate(date: string, tz: string): DateTime {
  if (!ISO_DATE_RE.test(date)) throw new RangeError(`Invalid local date: ${date}`);
  const dt = DateTime.fromISO(date, { zone: tz });
  if (!dt.isValid) throw new RangeError(`Invalid local date: ${date} (${dt.invalidReason})`);
  return dt;
}

/**
 * Converts a wall-clock time (local date + minute of day) in `tz` to a UTC instant.
 * `minuteOfDay` may be 1440, meaning midnight at the start of the next day.
 *
 * Wall-clock times that do not exist (inside a spring-forward gap) clamp to the instant the clocks
 * jump forward: 02:30 on a US spring-forward day becomes 03:00 local. Clamping (rather than
 * shifting by the gap length, which is Luxon's default) means a working window lying wholly inside
 * the gap collapses to nothing instead of silently moving an hour later. Ambiguous times (inside a
 * fall-back overlap) resolve to the earlier of the two instants.
 */
export function wallTimeToUtc(date: string, minuteOfDay: number, tz: string): Date {
  if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > 1440) {
    throw new RangeError(`minuteOfDay out of range: ${minuteOfDay}`);
  }
  let day = parseLocalDate(date, tz);
  let minute = minuteOfDay;
  if (minute === 1440) {
    day = day.plus({ days: 1 });
    minute = 0;
  }
  const hour = Math.floor(minute / 60);
  const min = minute % 60;
  const dt = DateTime.fromObject(
    { year: day.year, month: day.month, day: day.day, hour, minute: min },
    { zone: tz },
  );
  if (dt.hour === hour && dt.minute === min) return dt.toUTC().toJSDate();
  return gapEnd(dt).toJSDate();
}

/**
 * `shifted` is Luxon's normalization of a nonexistent wall time (requested time + gap length,
 * using the post-transition offset). The transition happened at most 3 hours before it, so binary
 * search that range at one-minute resolution for the first instant with the new offset.
 */
function gapEnd(shifted: DateTime): DateTime {
  const after = shifted.offset;
  let lo = shifted.toMillis() - 3 * 3_600_000;
  let hi = shifted.toMillis();
  const zone = shifted.zone;
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
    if (DateTime.fromMillis(mid, { zone }).offset === after) hi = mid;
    else lo = mid;
  }
  return DateTime.fromMillis(hi, { zone: "utc" });
}

/** The local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function toLocalDate(instant: Date, tz: string): string {
  return DateTime.fromJSDate(instant, { zone: tz }).toISODate()!;
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a local date. */
export function localWeekday(date: string, tz: string): number {
  return parseLocalDate(date, tz).weekday;
}

/** UTC instants for local midnight..next local midnight of `date` in `tz` (23h/25h on DST days). */
export function localDayBounds(date: string, tz: string): { start: Date; end: Date } {
  const start = parseLocalDate(date, tz).startOf("day");
  const end = start.plus({ days: 1 });
  return { start: start.toUTC().toJSDate(), end: end.toUTC().toJSDate() };
}

/** Inclusive list of local dates between `from` and `to`. */
export function eachLocalDate(from: string, to: string): string[] {
  if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) throw new RangeError("Invalid date range");
  const out: string[] = [];
  let cur = DateTime.fromISO(from, { zone: "utc" });
  const end = DateTime.fromISO(to, { zone: "utc" });
  while (cur <= end) {
    out.push(cur.toISODate()!);
    cur = cur.plus({ days: 1 });
  }
  return out;
}

export function addDaysToLocalDate(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: "utc" }).plus({ days }).toISODate()!;
}

/** Start/end instants of the calendar month containing `now`, as seen in `tz`. */
export function localMonthBounds(now: Date, tz: string): { start: Date; end: Date } {
  const local = DateTime.fromJSDate(now, { zone: tz }).startOf("month");
  return {
    start: local.toUTC().toJSDate(),
    end: local.plus({ months: 1 }).toUTC().toJSDate(),
  };
}

/** Monday 00:00 local of the ISO week containing `instant`, as a local date string. */
export function localWeekStart(instant: Date, tz: string): string {
  return DateTime.fromJSDate(instant, { zone: tz }).startOf("week").toISODate()!;
}

export function formatInTimeZone(instant: Date, tz: string, format: string): string {
  return DateTime.fromJSDate(instant, { zone: tz }).toFormat(format);
}

/** Hour (0-23) of the given instant on the wall clock in `tz`. */
export function localHour(instant: Date, tz: string): number {
  return DateTime.fromJSDate(instant, { zone: tz }).hour;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}
