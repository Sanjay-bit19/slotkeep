import { type NextRequest } from "next/server";
import { POLICIES, rateLimit } from "@slotkeep/infra";
import { handlers } from "@/auth";
import { limitByIp } from "@/lib/http";

export const GET = handlers.GET;

/**
 * Auth POSTs are rate limited per IP, and magic-link requests additionally per target email so
 * nobody can use us to flood someone's inbox.
 */
export async function POST(req: NextRequest) {
  const { blocked } = await limitByIp(req, POLICIES.auth);
  if (blocked) return blocked;
  if (req.nextUrl.pathname.endsWith("/signin/email")) {
    const ipLimit = await limitByIp(req, POLICIES.authEmail);
    if (ipLimit.blocked) return ipLimit.blocked;
    const form = await req
      .clone()
      .formData()
      .catch(() => null);
    const email =
      typeof form?.get("email") === "string" ? String(form.get("email")).toLowerCase() : "";
    if (email) {
      const r = await rateLimit(POLICIES.authEmail, `email:${email}`);
      if (!r.success)
        return new Response("Too many sign-in emails requested. Try again later.", { status: 429 });
    }
  }
  return handlers.POST(req);
}
