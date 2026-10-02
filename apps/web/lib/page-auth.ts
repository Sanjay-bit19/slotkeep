import { notFound, redirect } from "next/navigation";
import {
  AuthzError,
  requireTenant,
  requireUser,
  type Permission,
  type TenantContext,
} from "./authz";

/** Page-level wrapper: turns authorization failures into redirects / 404s. */
export async function pageTenant(
  slug: string,
  permission: Permission,
  returnTo?: string,
): Promise<TenantContext> {
  try {
    return await requireTenant(slug, permission);
  } catch (err) {
    if (err instanceof AuthzError) {
      if (err.code === "UNAUTHENTICATED")
        redirect(`/login?callbackUrl=${encodeURIComponent(returnTo ?? `/dashboard/${slug}`)}`);
      if (err.code === "FORBIDDEN") redirect(`/dashboard/${slug}?denied=1`);
      notFound();
    }
    throw err;
  }
}

export async function pageUser(returnTo = "/dashboard") {
  try {
    return await requireUser();
  } catch (err) {
    if (err instanceof AuthzError) redirect(`/login?callbackUrl=${encodeURIComponent(returnTo)}`);
    throw err;
  }
}
