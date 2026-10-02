"use server";

import { redirect } from "next/navigation";
import { completeFakeSession } from "@slotkeep/infra";
import { fakePaymentsEnabled } from "@/lib/dev";

export async function payFakeSession(id: string) {
  if (!fakePaymentsEnabled()) throw new Error("Fake payments disabled");
  const res = await completeFakeSession(id);
  redirect(res.redirectTo);
}
