import Link from "next/link";
import { balanceDueCents, formatInTimeZone, formatMoney } from "@slotkeep/core";
import { DomainError } from "@slotkeep/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { bookingFromToken } from "@/lib/services/manage-bookings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Booking status", robots: { index: false } };

/**
 * Landing page after Stripe Checkout. It never confirms anything itself: the redirect can be
 * forged or arrive before payment settles. It just displays the booking's state, which only the
 * webhook changes, and polls until the webhook lands.
 */
export default async function SuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  const { t } = await searchParams;
  let data: Awaited<ReturnType<typeof bookingFromToken>> | null = null;
  let error: string | null = null;
  try {
    if (!t) throw new DomainError("INVALID_LINK", "Missing booking reference", 400);
    data = await bookingFromToken(t);
  } catch (err) {
    error = err instanceof DomainError ? err.message : "Something went wrong";
  }
  const b = data?.booking;
  const tz = b?.tenant.timezone ?? "UTC";

  return (
    <div style={{ ["--brand" as string]: b?.tenant.brandColor ?? "#4f46e5" }}>
      <main id="main" className="mx-auto max-w-xl px-5 py-16">
        {error || !b || b.tenant.slug !== slug ? (
          <div className="rounded-xl bg-white p-8 shadow-sm">
            <h1 className="text-2xl font-bold">We couldn&apos;t find that booking</h1>
            <p className="mt-2 text-slate-700">{error}</p>
          </div>
        ) : (
          <div
            className="rounded-xl bg-white p-8 shadow-sm"
            data-testid="booking-status"
            data-status={b.status}
          >
            {b.status === "PENDING_PAYMENT" && (
              <>
                <AutoRefresh />
                <h1 className="text-2xl font-bold text-slate-900">Confirming your payment…</h1>
                <p className="mt-2 text-slate-700" role="status">
                  This usually takes a few seconds. You&apos;ll also get a confirmation email.
                </p>
              </>
            )}
            {b.status === "CONFIRMED" && (
              <>
                <h1 className="text-2xl font-bold text-slate-900">You&apos;re booked!</h1>
                <p className="mt-2 text-slate-700">
                  A confirmation has been sent to {b.customer.email}.
                </p>
              </>
            )}
            {b.status === "CANCELLED" && (
              <>
                <h1 className="text-2xl font-bold text-slate-900">This booking is not active</h1>
                <p className="mt-2 text-slate-700">
                  {b.cancelReason === "PAYMENT_CONFLICT"
                    ? "Your payment arrived after the reservation expired and the time was taken. You've been refunded in full."
                    : b.cancelReason === "HOLD_EXPIRED"
                      ? "The 10-minute reservation expired before payment completed."
                      : "It was cancelled."}
                </p>
              </>
            )}
            <dl className="mt-6 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-600">Business</dt>
              <dd className="font-medium">{b.tenant.name}</dd>
              <dt className="text-slate-600">Service</dt>
              <dd className="font-medium">{b.service.name}</dd>
              <dt className="text-slate-600">With</dt>
              <dd className="font-medium">{b.staff.name}</dd>
              <dt className="text-slate-600">When</dt>
              <dd className="font-medium">
                {formatInTimeZone(b.startAt, tz, "cccc, LLLL d 'at' h:mm a ZZZZ")}
              </dd>
              {b.status === "CONFIRMED" && (
                <>
                  <dt className="text-slate-600">Deposit paid</dt>
                  <dd className="font-medium">{formatMoney(b.depositPaidCents, b.currency)}</dd>
                  <dt className="text-slate-600">Due on the day</dt>
                  <dd className="font-medium">
                    {formatMoney(balanceDueCents(b.priceCents, b.depositPaidCents), b.currency)}
                  </dd>
                </>
              )}
            </dl>
            {b.status === "CONFIRMED" && data?.current && (
              <Link
                href={`/m/${encodeURIComponent(t!)}`}
                className="mt-6 inline-block text-sm font-medium text-brand underline"
              >
                Need to reschedule or cancel?
              </Link>
            )}
            {b.status === "CANCELLED" && (
              <Link
                href={`/b/${slug}`}
                className="mt-6 inline-block text-sm font-medium text-brand underline"
              >
                Book another time
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
