import { NextResponse } from "next/server";
import { routeContext, errorResponse } from "@/lib/http";
import { handleStripeWebhook } from "@/lib/services/stripe-webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { log, requestId } = routeContext(req);
  try {
    // Raw body: the signature is computed over the exact bytes Stripe sent.
    const raw = await req.text();
    const res = await handleStripeWebhook(raw, req.headers.get("stripe-signature"), log, {
      requestId,
    });
    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    // 500 makes Stripe retry with backoff; the idempotency record was rolled back with the effects.
    return errorResponse(err, log);
  }
}
