import { NextResponse } from "next/server";
import { addDaysToLocalDate, availabilityQuerySchema, eachLocalDate } from "@slotkeep/core";
import { getAvailableSlots, NotFoundError, DomainError } from "@slotkeep/db";
import { POLICIES } from "@slotkeep/infra";
import { errorResponse, limitByIp, routeContext } from "@/lib/http";
import { findPublicTenant } from "@/lib/services/public-booking";

export const dynamic = "force-dynamic";

const MAX_PUBLIC_RANGE_DAYS = 14;
const MAX_DAYS_AHEAD = 90;

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { log } = routeContext(req, { slug });
  const { headers, blocked } = await limitByIp(req, POLICIES.publicRead);
  if (blocked) return blocked;
  try {
    const url = new URL(req.url);
    const q = availabilityQuerySchema.parse({
      serviceId: url.searchParams.get("serviceId") ?? "",
      staffId: url.searchParams.get("staffId") || undefined,
      from: url.searchParams.get("from") ?? "",
      to: url.searchParams.get("to") ?? url.searchParams.get("from") ?? "",
    });
    if (eachLocalDate(q.from, q.to).length > MAX_PUBLIC_RANGE_DAYS) {
      throw new DomainError(
        "RANGE_TOO_LARGE",
        `At most ${MAX_PUBLIC_RANGE_DAYS} days per request`,
        400,
      );
    }
    const tenant = await findPublicTenant(slug);
    if (!tenant) throw new NotFoundError("Business");
    const horizon = addDaysToLocalDate(new Date().toISOString().slice(0, 10), MAX_DAYS_AHEAD);
    const slots = await getAvailableSlots({
      tenant,
      serviceId: q.serviceId,
      staffId: q.staffId === "any" ? undefined : q.staffId,
      fromDate: q.from,
      // Bookings open MAX_DAYS_AHEAD days out; beyond that the range collapses to nothing.
      toDate: q.to > horizon ? horizon : q.to,
      now: new Date(),
    }).catch((err) => {
      if (err instanceof RangeError) return [];
      throw err;
    });
    if (!slots) throw new NotFoundError("Service");
    return NextResponse.json(
      {
        timezone: tenant.timezone,
        slots: slots.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          staffIds: s.staffIds,
        })),
      },
      { headers: { ...headers, "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err, log, headers);
  }
}
