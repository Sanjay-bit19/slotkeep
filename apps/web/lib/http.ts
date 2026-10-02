import { NextResponse } from "next/server";
import {
  rateLimit,
  rateLimitHeaders,
  requestLogger,
  type Logger,
  type RateLimitPolicy,
} from "@slotkeep/infra";
import { toPublicError } from "./errors";
import { clientIp, requestIdFrom } from "./request";

export function routeContext(
  req: Request,
  extra: Record<string, unknown> = {},
): { log: Logger; requestId: string } {
  const requestId = requestIdFrom(req);
  return {
    requestId,
    log: requestLogger(requestId, {
      path: new URL(req.url).pathname,
      method: req.method,
      ...extra,
    }),
  };
}

export function errorResponse(
  err: unknown,
  log: Logger,
  headers: Record<string, string> = {},
): NextResponse {
  const e = toPublicError(err, log);
  return NextResponse.json(
    { error: { code: e.code, message: e.message, fieldErrors: e.fieldErrors } },
    { status: e.status, headers },
  );
}

/** Applies a rate limit policy keyed by client IP. Returns a 429 response when exceeded. */
export async function limitByIp(req: Request, policy: RateLimitPolicy, suffix = "") {
  const res = await rateLimit(policy, `${clientIp(req)}${suffix ? `:${suffix}` : ""}`);
  const headers = rateLimitHeaders(res);
  if (!res.success) {
    return {
      headers,
      blocked: NextResponse.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Please wait a moment and try again.",
          },
        },
        { status: 429, headers },
      ),
    };
  }
  return { headers, blocked: null };
}
