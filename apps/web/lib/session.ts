import { cache } from "react";
import { auth } from "@/auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

/** The signed-in user, or null. Isolated in its own module so tests can stub authentication. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.email) return null;
  return { id: u.id, email: u.email, name: u.name ?? null };
});
