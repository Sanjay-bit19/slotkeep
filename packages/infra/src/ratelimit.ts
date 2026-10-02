import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { env } from "./env";
import { logger } from "./logger";
import { redis } from "./redis";

/**
 * Sliding-window-log rate limiter backed by a Redis sorted set. One Lua script per check, so the
 * trim/count/add sequence is atomic across concurrent requests and multiple app instances.
 *
 * Fails open: if Redis is unreachable we log and allow the request. A limiter outage should not
 * take bookings down; the DB constraints still protect correctness.
 */

const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, 0}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retry = window - (now - tonumber(oldest[2]))
return {0, 0, retry}
`;

export interface RateLimitPolicy {
  /** Logical bucket name, e.g. "booking:create". */
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Milliseconds until a request would be allowed again (0 when allowed). */
  retryAfterMs: number;
}

export const POLICIES = {
  publicRead: { name: "public:read", limit: 120, windowMs: 60_000 },
  bookingCreate: { name: "booking:create", limit: 10, windowMs: 60_000 },
  manageLink: { name: "manage", limit: 30, windowMs: 60_000 },
  authEmail: { name: "auth:email", limit: 5, windowMs: 15 * 60_000 },
  auth: { name: "auth", limit: 30, windowMs: 60_000 },
} satisfies Record<string, RateLimitPolicy>;

export async function rateLimit(
  policy: RateLimitPolicy,
  identifier: string,
  opts: { client?: Redis; now?: number; force?: boolean } = {},
): Promise<RateLimitResult> {
  if (!opts.force && env().RATE_LIMIT_DISABLED) {
    return { success: true, limit: policy.limit, remaining: policy.limit, retryAfterMs: 0 };
  }
  const client = opts.client ?? redis();
  const now = opts.now ?? Date.now();
  try {
    const [ok, remaining, retry] = (await client.eval(
      SCRIPT,
      1,
      `rl:${policy.name}:${identifier}`,
      now,
      policy.windowMs,
      policy.limit,
      `${now}-${randomUUID()}`,
    )) as [number, number, number];
    return { success: ok === 1, limit: policy.limit, remaining, retryAfterMs: Math.max(0, retry) };
  } catch (err) {
    logger.warn({ err, policy: policy.name }, "rate limiter unavailable; failing open");
    return { success: true, limit: policy.limit, remaining: policy.limit, retryAfterMs: 0 };
  }
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
  };
  if (!r.success) h["Retry-After"] = String(Math.ceil(r.retryAfterMs / 1000));
  return h;
}
