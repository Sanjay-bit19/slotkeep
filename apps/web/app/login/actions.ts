"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { POLICIES, rateLimit } from "@slotkeep/infra";
import { signIn } from "@/auth";
import { runAction, type ActionResult } from "@/lib/actions";

const schema = z.object({
  email: z.email("Enter a valid email address").transform((e) => e.toLowerCase()),
  callbackUrl: z.string().startsWith("/").default("/dashboard"),
});

async function ip(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
}

export async function requestMagicLink(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  return runAction("requestMagicLink", async () => {
    const input = schema.parse({
      email: fd.get("email"),
      callbackUrl: fd.get("callbackUrl") || undefined,
    });
    // Server actions call Auth.js directly (not via the HTTP route), so rate limit here too.
    const byIp = await rateLimit(POLICIES.authEmail, await ip());
    const byEmail = await rateLimit(POLICIES.authEmail, `email:${input.email}`);
    if (!byIp.success || !byEmail.success) {
      return {
        ok: false,
        error: "Too many sign-in attempts. Please wait a few minutes and try again.",
      } as const;
    }
    await signIn("email", { email: input.email, redirectTo: input.callbackUrl });
    return { ok: true } as const;
  });
}

export async function signInWithGoogle(fd: FormData) {
  const callbackUrl = String(fd.get("callbackUrl") || "/dashboard");
  await signIn("google", { redirectTo: callbackUrl.startsWith("/") ? callbackUrl : "/dashboard" });
}
