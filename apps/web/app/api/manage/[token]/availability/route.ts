import { NextResponse } from "next/server";
import { localDateSchema } from "@slotkeep/core";
import { getAvailableSlots } from "@slotkeep/db";
import { POLICIES } from "@slotkeep/infra";
import { errorResponse, limitByIp, routeContext } from "@/lib/http";
import { bookingFromToken } from "@/lib/services/manage-bookings";

export const dynamic = "force-dynamic";

/** Reschedule availability: same service and staff, ignoring the booking's own current slot. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { log } = routeContext(req);
  const { headers, blocked } = await limitByIp(req, POLICIES.manageLink);
  if (blocked) return blocked;
  try {
    const date = localDateSchema.parse(new URL(req.url).searchParams.get("date") ?? "");
    const { booking } = await bookingFromToken(token);
    const slots =
      (await getAvailableSlots({
        tenant: booking.tenant,
        serviceId: booking.serviceId,
        staffId: booking.staffId,
        fromDate: date,
        toDate: date,
        now: new Date(),
        excludeBookingId: booking.id,
      })) ?? [];
    return NextResponse.json(
      {
        timezone: booking.tenant.timezone,
        slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
      },
      { headers: { ...headers, "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err, log, headers);
  }
}
