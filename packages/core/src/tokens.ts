import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless signed tokens for customer self-service links (cancel / reschedule).
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)).
 * The payload carries the booking's `tokenVersion`; bumping that column (on reschedule or
 * cancel) revokes every link issued before, without a token table.
 */

export interface ManageTokenPayload {
  /** Booking id. */
  b: string;
  /** Booking token version at issue time. */
  v: number;
  /** Expiry, unix seconds. */
  e: number;
}

export type VerifyResult =
  | { ok: true; payload: ManageTokenPayload }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(data: string, secret: string): Buffer {
  if (!secret || secret.length < 16) throw new Error("Token secret must be at least 16 characters");
  return createHmac("sha256", secret).update(data).digest();
}

export function signManageToken(
  input: { bookingId: string; version: number; expiresAt: Date },
  secret: string,
): string {
  const payload: ManageTokenPayload = {
    b: input.bookingId,
    v: input.version,
    e: Math.floor(input.expiresAt.getTime() / 1000),
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(sign(body, secret))}`;
}

export function verifyManageToken(token: string, secret: string, now: Date): VerifyResult {
  if (typeof token !== "string") return { ok: false, reason: "MALFORMED" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "MALFORMED" };
  const [body, sig] = parts as [string, string];
  const expected = sign(body, secret);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }
  let payload: ManageTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ManageTokenPayload;
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (
    typeof payload?.b !== "string" ||
    typeof payload.v !== "number" ||
    typeof payload.e !== "number"
  ) {
    return { ok: false, reason: "MALFORMED" };
  }
  if (payload.e * 1000 <= now.getTime()) return { ok: false, reason: "EXPIRED" };
  return { ok: true, payload };
}

/**
 * Links stay valid until the appointment starts, but never longer than `maxDays` from issue, so a
 * leaked email for a booking months out is not a long-lived credential.
 */
export function manageTokenExpiry(startAt: Date, now: Date, maxDays = 30): Date {
  const cap = now.getTime() + maxDays * 86_400_000;
  return new Date(Math.min(startAt.getTime(), cap));
}
