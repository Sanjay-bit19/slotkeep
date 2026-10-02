# ADR 0003: UTC instants, wall-clock schedules, and a pure availability engine

- Status: accepted
- Date: 2026-10-02

## Context

A salon in New York says "we open at 9". That's a wall-clock rule: 9:00 in summer is 13:00 UTC,
in winter 14:00 UTC. On DST days a local day is 23 or 25 hours long, 02:30 may not exist (spring
forward), and 01:30 may happen twice (fall back). Customers can book from other timezones.

## Decision

- **Every instant is stored as `timestamptz` holding UTC** (bookings, time off, holds).
  Conversion happens only at the edges: rendering, email copy, and interpreting weekly rules.
- **Weekly availability is stored as wall-clock data:** ISO weekday plus
  `startMinute`/`endMinute` after local midnight, interpreted in `Tenant.timezone` (an IANA zone,
  validated). Store "9:00 local", never "14:00 UTC".
- **The availability engine (`packages/core/src/availability.ts`) is pure.** Input: timezone,
  local date range, service duration and buffer, each staff member's rules, time off and busy
  intervals, and `now`. Output: slots as UTC instants. No clock, no I/O. Database loading lives
  separately in `packages/db/src/availability.ts`.
- **DST policy, explicit and tested:**
  - Working windows are real intervals `[toUtc(start), toUtc(end))`. Slots step in absolute
    minutes from the window start, so a 00:00-04:00 window is 3 real hours on spring-forward day
    and 5 on fall-back day.
  - A nonexistent wall time clamps to the moment clocks jump forward (02:30 becomes 03:00). We
    deliberately don't use Luxon's default (02:30 becomes 03:30), because a window lying wholly
    inside the gap would then silently move an hour later. A test caught exactly that bug.
  - An ambiguous wall time resolves to the earlier instant.
  - Weekdays are evaluated in the tenant zone (Tuesday 22:00 in New York is already Wednesday in
    UTC).
- **Buffers:** a slot's whole footprint (duration plus buffer) must fit inside working hours, so
  staff are never booked into cleanup time after closing. Busy intervals already include each
  existing booking's buffer (`blockedUntil`).
- Daily summary emails go out at 07:00 _tenant-local_: one hourly job checks which tenants are
  at local hour 7, so DST and every timezone are handled without per-tenant cron entries.

## Consequences

- `packages/core` has 100% line coverage, with tests for New York and London spring-forward and
  fall-back, Lord Howe's 30-minute shift, Asia/Kolkata's +5:30 offset, windows inside DST gaps,
  bookings in the repeated hour, overlapping and unsorted busy intervals, buffers at day edges,
  windows ending at midnight, and lead time.
- The browser renders times with `Intl.DateTimeFormat({ timeZone: tenant.timezone })` and labels
  the zone, so a customer in another timezone sees the business's local time.
- Changing a tenant's timezone reinterprets weekly hours but leaves existing bookings at their
  exact instants. That is the correct behaviour, and the settings page says so.
