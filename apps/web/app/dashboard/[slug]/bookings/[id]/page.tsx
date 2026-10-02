import Link from "next/link";
import { notFound } from "next/navigation";
import { balanceDueCents, canTransition, formatInTimeZone, formatMoney } from "@slotkeep/core";
import { CancelBookingForm, OutcomeButtons } from "@/components/booking-actions";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/authz";
import { bookingDetail } from "@/lib/data";
import { pageTenant } from "@/lib/page-auth";
import { cancelBookingAction, markOutcomeAction } from "../../actions";

export const metadata = { title: "Booking" };

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const ctx = await pageTenant(slug, "booking:read");
  const b = await bookingDetail(ctx, id);
  if (!b) notFound();
  const tz = ctx.tenant.timezone;
  const started = b.startAt <= new Date();
  const refundable = b.depositPaidCents - b.refundedCents;

  const rows: Array<[string, React.ReactNode]> = [
    ["Status", <StatusBadge key="s" status={b.status} />],
    [
      "When",
      `${formatInTimeZone(b.startAt, tz, "cccc, LLLL d, yyyy h:mm a")} – ${formatInTimeZone(b.endAt, tz, "h:mm a")}`,
    ],
    ["Service", b.service.name],
    ["Staff", b.staff.name],
    ["Customer", `${b.customer.name} <${b.customer.email}>`],
    ["Phone", b.customer.phone || "—"],
    ["Price", formatMoney(b.priceCents, b.currency)],
    ["Deposit paid", formatMoney(b.depositPaidCents, b.currency)],
    ["Refunded", formatMoney(b.refundedCents, b.currency)],
    [
      "Due at appointment",
      b.status === "CANCELLED"
        ? "—"
        : formatMoney(balanceDueCents(b.priceCents, b.depositPaidCents), b.currency),
    ],
    ["Notes", b.notes || "—"],
  ];
  if (b.cancelReason)
    rows.push([
      "Cancellation",
      `${b.cancelReason.replaceAll("_", " ").toLowerCase()} on ${formatInTimeZone(b.cancelledAt!, tz, "LLL d, h:mm a")}`,
    ]);

  const canOutcome = can(ctx.role, "booking:outcome") && started;
  const canCancel = can(ctx.role, "booking:cancel") && canTransition(b.status, "CANCELLED");

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/dashboard/${slug}/bookings`} className="text-sm text-brand underline">
        ← All bookings
      </Link>
      <h1 className="text-2xl font-bold text-slate-900">Booking for {b.customer.name}</h1>
      <Card>
        <CardContent className="pt-6">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-sm text-slate-600">{k}</dt>
                <dd className="text-sm font-medium text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      {(canOutcome || canCancel) && (
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {canOutcome && (
              <OutcomeButtons
                markCompleted={markOutcomeAction.bind(null, slug, b.id, "COMPLETED")}
                markNoShow={markOutcomeAction.bind(null, slug, b.id, "NO_SHOW")}
                showCompleted={canTransition(b.status, "COMPLETED")}
                showNoShow={canTransition(b.status, "NO_SHOW")}
              />
            )}
            {canCancel && (
              <CancelBookingForm
                action={cancelBookingAction.bind(null, slug, b.id)}
                refundLabel={
                  refundable > 0
                    ? `${formatMoney(refundable, b.currency)} will be refunded to the customer.`
                    : "No payment to refund."
                }
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
