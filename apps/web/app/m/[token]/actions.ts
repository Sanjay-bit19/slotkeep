"use server";

import { revalidatePath } from "next/cache";
import { POLICIES, rateLimit } from "@slotkeep/infra";
import { headers } from "next/headers";
import { formatInTimeZone } from "@slotkeep/core";
import { runAction, type ActionResult } from "@/lib/actions";
import { actionLogger } from "@/lib/request";
import { cancelAsCustomer, rescheduleAsCustomer } from "@/lib/services/manage-bookings";

async function limited(): Promise<boolean> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return !(await rateLimit(POLICIES.manageLink, ip)).success;
}

export async function customerCancel(
  token: string,
  _p: ActionResult | null,
): Promise<ActionResult> {
  return runAction("customerCancel", async () => {
    if (await limited())
      return { ok: false, error: "Too many requests. Try again shortly." } as const;
    const { log, requestId } = await actionLogger();
    const out = await cancelAsCustomer(token, log, { requestId });
    return {
      ok: true,
      message:
        out.refundCents > 0
          ? `Cancelled. $${(out.refundCents / 100).toFixed(2)} will be refunded to your card.`
          : "Cancelled. Your deposit was non-refundable because this was inside the cancellation window.",
    } as const;
  });
}

export async function customerReschedule(
  token: string,
  _p: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const res = await runAction("customerReschedule", async () => {
    if (await limited())
      return { ok: false, error: "Too many requests. Try again shortly." } as const;
    const start = new Date(String(fd.get("start") ?? ""));
    if (Number.isNaN(start.getTime())) return { ok: false, error: "Pick a new time" } as const;
    const { log, requestId } = await actionLogger();
    const b = await rescheduleAsCustomer(token, start, log, { requestId });
    return {
      ok: true,
      message: `Moved to ${formatInTimeZone(b.startAt, b.tenant.timezone, "cccc, LLLL d 'at' h:mm a")}. We've emailed you an updated confirmation with a new link.`,
    } as const;
  });
  revalidatePath(`/m/${token}`);
  return res;
}
