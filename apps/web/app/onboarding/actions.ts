"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/authz";
import { runAction, type ActionResult } from "@/lib/actions";
import { createTenantForUser } from "@/lib/services/tenants";

export async function createBusiness(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  let slug = "";
  const res = await runAction("createBusiness", async () => {
    const user = await requireUser();
    const tenant = await createTenantForUser(user, {
      name: fd.get("name"),
      slug: fd.get("slug"),
      timezone: fd.get("timezone"),
      brandColor: fd.get("brandColor") || undefined,
    });
    slug = tenant.slug;
  });
  if (res.ok) redirect(`/dashboard/${slug}?welcome=1`);
  return res;
}
