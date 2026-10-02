import {
  manageTokenExpiry,
  signManageToken,
  verifyManageToken,
  type VerifyResult,
} from "@slotkeep/core";
import { env } from "./env";

export function manageUrlFor(
  b: { id: string; tokenVersion: number; startAt: Date },
  now = new Date(),
): string {
  const token = signManageToken(
    { bookingId: b.id, version: b.tokenVersion, expiresAt: manageTokenExpiry(b.startAt, now) },
    env().MANAGE_TOKEN_SECRET,
  );
  return `${env().APP_URL}/m/${token}`;
}

export function verifyManageLinkToken(token: string, now = new Date()): VerifyResult {
  return verifyManageToken(token, env().MANAGE_TOKEN_SECRET, now);
}
