import { NextResponse, type NextRequest } from "next/server";

/**
 * Assigns every request an id (or keeps the one a proxy sent) and exposes it to route handlers
 * via the x-request-id header. Handlers log with it and copy it into enqueued jobs, so one id
 * follows a booking from HTTP request to background email.
 *
 * Authentication is NOT checked here: sessions live in Postgres, which the edge runtime can't
 * reach. Every protected page and action authorizes server-side through lib/authz.ts.
 */
export function middleware(req: NextRequest) {
  const incoming = req.headers.get("x-request-id");
  const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set("x-request-id", requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
