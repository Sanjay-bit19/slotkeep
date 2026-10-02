# ADR 0001: Prevent double-booking with a Postgres exclusion constraint

- Status: accepted
- Date: 2026-10-02

## Context

Two customers can load the same open slot and submit at the same moment. Any check-then-insert
done in application code ("is this slot free? then insert") races: both checks pass, both inserts
succeed. Buffers make it harder: a booking blocks `[start, end + buffer)`, so conflicts are range
overlaps, not equal start times. A unique index on `(staffId, startAt)` doesn't catch overlaps.

Options considered:

1. **Application check + `SELECT ... FOR UPDATE`** on the staff member's bookings for the day.
   It works, but only if every code path that writes bookings remembers to take the lock in the
   same order. Reschedule, admin edits, scripts, and future features are all chances to forget.
2. **Advisory lock per staff member** (`pg_advisory_xact_lock(hash(staffId))`). Same weakness: the
   invariant lives in code, not in the data.
3. **Exclusion constraint** using `btree_gist`:
   `EXCLUDE USING gist ("staffId" WITH =, tstzrange("startAt", "blockedUntil", '[)') WITH &&)
WHERE (status IN ('PENDING_PAYMENT','CONFIRMED','COMPLETED','NO_SHOW'))`.

## Decision

Use the exclusion constraint (option 3), in the hand-written migration
`packages/db/prisma/migrations/20261002045600_constraints`.

- `blockedUntil = endAt + service buffer` is stored on the row, so the constraint protects buffers.
- `'[)'` half-open ranges let back-to-back bookings touch without overlapping.
- The partial `WHERE` means cancelled bookings free their slot automatically. Slot holds are just
  `PENDING_PAYMENT` rows, so a held slot is protected by the same constraint.
- The app maps SQLSTATE `23P01` to `SlotUnavailableError` (HTTP 409). For "any staff" bookings it
  tries the next eligible staff member.
- Prisma doesn't model exclusion constraints. A `migrate diff` against the schema shows no drift,
  so future `prisma migrate dev` runs don't try to drop it (verified when it was added).

## Consequences

- Correctness doesn't depend on any code path remembering to lock. Even a raw `INSERT` from psql
  can't double-book (covered by an integration test).
- Under contention, a conflicting insert waits for the competing transaction to finish, then
  fails. The k6 contention run measured contended booking latency at p50 239 ms vs 28 ms
  uncontended.
- Concurrency test: 20 simultaneous requests for one slot produce exactly one booking; with
  three staff and "any", exactly three bookings on three distinct staff
  (`packages/db/test/bookings.int.test.ts`).
- Free-plan quota checks (50 bookings/month) are not range conflicts. They use a per-tenant
  advisory lock, taken only for capped tenants, so paid tenants never serialize on it.
- An expired hold still occupies its range until it is cancelled. The booking transaction first
  releases overlapping expired holds, so a lagging expiry job never blocks a real customer.
