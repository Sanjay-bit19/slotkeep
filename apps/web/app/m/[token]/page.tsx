import { computeRefundCents, formatInTimeZone, formatMoney, toLocalDate } from "@slotkeep/core";
import { DomainError } from "@slotkeep/db";
import { ManageBooking } from "@/components/manage-booking";
import { StatusBadge } from "@/components/ui/badge";
import { bookingFromToken } from "@/lib/services/manage-bookings";
import { customerCancel, customerReschedule } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage your booking", robots: { index: false } };

export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { token: raw } = await params;
  const { notice } = await searchParams;
  const token = decodeURIComponent(raw);
  let data: Awaited<ReturnType<typeof bookingFromToken>> | null = null;
  let error: string | null = null;
  try {
    data = await bookingFromToken(token);
  } catch (err) {
    error = err instanceof DomainError ? err.message : "Something went wrong";
  }
  if (!data) {
    return (
      <main id="main" className="mx-auto max-w-xl px-5 py-16">
        <div className="rounded-xl bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold">Link unavailable</h1>
          <p className="mt-2 text-slate-700">{error}</p>
        </div>
      </main>
    );
  }
  const { booking: b, current } = data;
  const tz = b.tenant.timezone;
  const now = new Date();
  const active = b.status === "CONFIRMED" && b.startAt > now;
  const cutoff = new Date(b.startAt.getTime() - b.tenant.cancellationWindowHours * 3_600_000);
  const refund = computeRefundCents({
    depositPaidCents: b.depositPaidCents,
    alreadyRefundedCents: b.refundedCents,
    startAt: b.startAt,
    now,
    cancellationWindowHours: b.tenant.cancellationWindowHours,
    initiatedBy: "CUSTOMER",
  });
  const cancelNote =
    b.depositPaidCents === 0
      ? "No payment was taken, so there's nothing to refund."
      : refund > 0
        ? `Cancel before ${formatInTimeZone(cutoff, tz, "LLL d, h:mm a")} for a full ${formatMoney(refund, b.currency)} refund.`
        : `This is within ${b.tenant.cancellationWindowHours} hours of your appointment, so the ${formatMoney(b.depositPaidCents, b.currency)} deposit is non-refundable.`;

  return (
    <div style={{ ["--brand" as string]: b.tenant.brandColor }}>
      <main id="main" className="mx-auto max-w-2xl px-5 py-12">
        <p className="text-sm text-slate-600">{b.tenant.name}</p>
        <h1 className="text-2xl font-bold text-slate-900">Your booking</h1>
        {notice === "rescheduled" && current && (
          <p
            role="status"
            className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
          >
            Your booking has been moved. We&apos;ve emailed you an updated confirmation; links in
            older emails no longer work.
          </p>
        )}
        <div className="mt-4 rounded-xl bg-white p-6 shadow-sm">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-600">Status</dt>
            <dd>
              <StatusBadge status={b.status} />
            </dd>
            <dt className="text-slate-600">Service</dt>
            <dd className="font-medium">{b.service.name}</dd>
            <dt className="text-slate-600">With</dt>
            <dd className="font-medium">{b.staff.name}</dd>
            <dt className="text-slate-600">When</dt>
            <dd className="font-medium">
              {formatInTimeZone(b.startAt, tz, "cccc, LLLL d 'at' h:mm a ZZZZ")}
            </dd>
          </dl>
        </div>
        <div className="mt-8">
          {!current ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              This booking has changed since this link was sent. Please use the link in your most
              recent email.
            </p>
          ) : active ? (
            <ManageBooking
              token={token}
              timezone={tz}
              today={toLocalDate(now, tz)}
              canReschedule={now <= cutoff}
              cancelNote={cancelNote}
              cancelAction={customerCancel.bind(null, token)}
              rescheduleAction={customerReschedule.bind(null, token)}
            />
          ) : (
            <p className="text-sm text-slate-700">
              There&apos;s nothing to change on this booking.
            </p>
          )}
          {current && active && now > cutoff && (
            <p className="mt-4 text-sm text-slate-600">
              Online rescheduling closes {b.tenant.cancellationWindowHours} hours before the
              appointment.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
