import { NextResponse } from "next/server";
import { POLICIES } from "@slotkeep/infra";
import { errorResponse, limitByIp, routeContext } from "@/lib/http";
import { startPublicBooking } from "@/lib/services/public-booking";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { log, requestId } = routeContext(req, { slug });
  const { headers, blocked } = await limitByIp(req, POLICIES.bookingCreate, slug);
  if (blocked) return blocked;
  try {
    const body = await req.json().catch(() => ({}));
    const result = await startPublicBooking({ slug, body, requestId, log });
    return NextResponse.json(result, { status: 201, headers });
  } catch (err) {
    return errorResponse(err, log, headers);
  }
}
