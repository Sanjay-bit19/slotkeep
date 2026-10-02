# ADR 0002: Confirm bookings only from idempotent Stripe webhooks

- Status: accepted
- Date: 2026-10-02

## Context

After Checkout, Stripe redirects the customer to our success URL. That redirect is not proof of
payment: it can be forged, replayed, or arrive before the payment settles (async methods). Stripe
also delivers webhooks at least once, can deliver the same event concurrently, and doesn't
guarantee order.

## Decision

1. **Only `checkout.session.completed` with `payment_status = paid` confirms a booking.** The
   success page just displays the booking's state and polls until the webhook lands.
2. **Verify the signature on the raw body** (`stripe.webhooks.constructEvent`, 5-minute tolerance)
   before parsing anything. Bad signatures get a 400 and never touch the database.
3. **Idempotency in the same transaction as the effects.** The handler runs
   `INSERT INTO "ProcessedWebhookEvent" (id) ... ON CONFLICT DO NOTHING RETURNING id`, then
   applies the event in the same transaction. A duplicate (even a concurrent one, which blocks on
   the first transaction's uncommitted row) inserts nothing and is acknowledged with 200. If
   applying fails, the event row rolls back too, so Stripe's retry is a clean second attempt.
4. **Side effects (emails, refunds) are enqueued inside the transaction, just before commit,**
   with deterministic job ids (BullMQ ignores duplicates). The consumers re-check booking state:
   - if the commit fails, the job finds the booking unconfirmed and does nothing;
   - if the job runs before the commit is visible, it throws and retries with backoff.
     This gives effectively-once behaviour without a transactional outbox table. The tradeoff: it
     relies on every consumer being state-checking and idempotent (email sends are keyed by a
     unique `dedupeKey`; refunds use a Stripe idempotency key `refund-<bookingId>`).
5. **Late payments.** Our hold lasts 10 minutes, but Stripe Checkout sessions live at least 30.
   The hold-expiry job explicitly expires the session. If a payment still lands after the hold was
   released, the handler re-confirms the booking if the slot is still free (guarded by
   `NOT EXISTS` plus the exclusion constraint). Otherwise it marks `PAYMENT_CONFLICT`, refunds in
   full via a retrying job, and emails an apology.
6. **Subscription events can arrive out of order.** `Tenant.billingEventAt` stores the `created`
   time of the newest event applied; older events are ignored.

## Consequences

- Covered by `apps/web/test/integration/webhooks.int.test.ts`: bad and tampered signatures, a
  normal confirm, redelivery, 5 concurrent duplicates (exactly one applied), unpaid async
  sessions, the late-payment conflict leading to a refund job, expired sessions, and out-of-order
  subscription events.
- Local dev and CI run without Stripe keys: the fake gateway signs Stripe-shaped events with the
  same webhook secret and POSTs them to the real endpoint, so the verification and idempotency
  code paths are the ones that run in production.
