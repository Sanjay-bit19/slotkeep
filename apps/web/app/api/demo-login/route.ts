import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@slotkeep/db";
import { POLICIES } from "@slotkeep/infra";
import { DEMO_ACCOUNTS } from "@/lib/demo";
import { limitByIp } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * One-click sign-in for the public demo, enabled only with DEMO_LOGIN_ENABLED=true.
 *
 * It does not bypass Auth.js: it mints a normal single-use verification token (stored hashed,
 * exactly as Auth.js stores magic-link tokens) and redirects to the standard email callback,
 * which validates and consumes it and creates a database session.
 */
export async function GET(req: Request) {
  if (process.env.DEMO_LOGIN_ENABLED !== "true")
    return new NextResponse("Not found", { status: 404 });
  const { blocked } = await limitByIp(req, POLICIES.auth);
  if (blocked) return blocked;

  const as = new URL(req.url).searchParams.get("as") ?? "owner";
  const email = DEMO_ACCOUNTS[as];
  if (!email) return new NextResponse("Unknown demo account", { status: 400 });

  const secret = process.env.AUTH_SECRET;
  if (!secret) return new NextResponse("AUTH_SECRET missing", { status: 500 });
  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 5 * 60_000),
    },
  });
  const base = process.env.AUTH_URL ?? process.env.APP_URL ?? new URL(req.url).origin;
  const callback = new URL("/api/auth/callback/email", base);
  callback.searchParams.set("token", token);
  callback.searchParams.set("email", email);
  callback.searchParams.set("callbackUrl", "/dashboard");
  return NextResponse.redirect(callback);
}
