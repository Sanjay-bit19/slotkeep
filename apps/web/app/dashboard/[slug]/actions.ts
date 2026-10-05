"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseMoneyToCents, parseTimeOfDay, wallTimeToUtc } from "@slotkeep/core";
import { DomainError } from "@slotkeep/db";
import { requireTenant } from "@/lib/authz";
import { formString, runAction, type ActionResult } from "@/lib/actions";
import { actionLogger } from "@/lib/request";
import { startUpgrade, openBillingPortal } from "@/lib/services/billing";
import {
  addTimeOff,
  createService,
  createStaff,
  deleteTimeOff,
  updateService,
  updateStaff,
} from "@/lib/services/catalog";
import { cancelAsOwner, markOutcome } from "@/lib/services/manage-bookings";
import { addMember, removeMember, updateTenantSettings } from "@/lib/services/tenants";

function money(fd: FormData, key: string): number {
  try {
    return parseMoneyToCents(formString(fd, key) || "0");
  } catch {
    throw new DomainError("VALIDATION", `Enter a valid amount for ${key}`, 400);
  }
}

const int = (fd: FormData, key: string) => Number.parseInt(formString(fd, key) || "0", 10);

export async function saveService(
  slug: string,
  serviceId: string | null,
  _p: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const res = await runAction("saveService", async () => {
    const ctx = await requireTenant(slug, "catalog:manage");
    const input = {
      name: formString(fd, "name"),
      description: formString(fd, "description"),
      durationMin: int(fd, "durationMin"),
      bufferMin: int(fd, "bufferMin"),
      priceCents: money(fd, "price"),
      depositCents: money(fd, "deposit"),
      active: fd.get("active") === "on",
    };
    if (serviceId) await updateService(ctx, serviceId, input);
    else await createService(ctx, input);
  });
  if (res.ok) {
    revalidatePath(`/dashboard/${slug}/services`);
    revalidatePath(`/b/${slug}`);
    redirect(`/dashboard/${slug}/services?saved=1`);
  }
  return res;
}

function weeklyFromForm(fd: FormData) {
  const weekly: Array<{ weekday: number; startMinute: number; endMinute: number }> = [];
  for (let d = 1; d <= 7; d++) {
    if (fd.get(`day-${d}-enabled`) !== "on") continue;
    try {
      weekly.push({
        weekday: d,
        startMinute: parseTimeOfDay(formString(fd, `day-${d}-start`)),
        endMinute: parseTimeOfDay(formString(fd, `day-${d}-end`)),
      });
    } catch {
      throw new DomainError("VALIDATION", "Use HH:MM for opening hours", 400);
    }
  }
  return weekly;
}

export async function saveStaff(
  slug: string,
  staffId: string | null,
  _p: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const res = await runAction("saveStaff", async () => {
    const ctx = await requireTenant(slug, "staff:manage");
    const input = {
      name: formString(fd, "name"),
      email: formString(fd, "email"),
      active: fd.get("active") === "on",
      serviceIds: fd.getAll("serviceIds").map(String),
      weekly: weeklyFromForm(fd),
    };
    if (staffId) await updateStaff(ctx, staffId, input);
    else await createStaff(ctx, input);
  });
  if (res.ok) {
    revalidatePath(`/dashboard/${slug}/staff`);
    revalidatePath(`/b/${slug}`);
    redirect(`/dashboard/${slug}/staff?saved=1`);
  }
  return res;
}

/** datetime-local values are wall-clock times in the tenant's timezone. */
function localDateTimeToUtc(value: string, tz: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!m) throw new DomainError("VALIDATION", "Enter a valid date and time", 400);
  return wallTimeToUtc(m[1]!, parseTimeOfDay(m[2]!), tz);
}

export async function addTimeOffAction(
  slug: string,
  staffId: string,
  _p: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const res = await runAction("addTimeOff", async () => {
    const ctx = await requireTenant(slug, "staff:manage");
    await addTimeOff(ctx, {
      staffId,
      startAt: localDateTimeToUtc(formString(fd, "start"), ctx.tenant.timezone),
      endAt: localDateTimeToUtc(formString(fd, "end"), ctx.tenant.timezone),
      reason: formString(fd, "reason"),
    });
    return { ok: true, message: "Time off added" } as const;
  });
  revalidatePath(`/dashboard/${slug}/staff/${staffId}`);
  return res;
}

export async function deleteTimeOffAction(slug: string, staffId: string, timeOffId: string) {
  const ctx = await requireTenant(slug, "staff:manage");
  await deleteTimeOff(ctx, timeOffId);
  revalidatePath(`/dashboard/${slug}/staff/${staffId}`);
}

export async function markOutcomeAction(
  slug: string,
  bookingId: string,
  status: "COMPLETED" | "NO_SHOW",
): Promise<ActionResult> {
  const res = await runAction("markOutcome", async () => {
    const ctx = await requireTenant(slug, "booking:outcome");
    await markOutcome(ctx, bookingId, status);
    return {
      ok: true,
      message: status === "COMPLETED" ? "Marked as completed" : "Marked as no-show",
    } as const;
  });
  revalidatePath(`/dashboard/${slug}/bookings/${bookingId}`);
  return res;
}

export async function cancelBookingAction(
  slug: string,
  bookingId: string,
  _p: ActionResult | null,
): Promise<ActionResult> {
  let refundStatus = "none";
  const res = await runAction("cancelBooking", async () => {
    const ctx = await requireTenant(slug, "booking:cancel");
    const { log, requestId } = await actionLogger({ tenantId: ctx.tenant.id, userId: ctx.user.id });
    refundStatus = (await cancelAsOwner(ctx, bookingId, log, { requestId })).refundStatus;
  });
  if (!res.ok) return res;
  revalidatePath(`/dashboard/${slug}/bookings`);
  // A fixed notice code, never free text, so a crafted link can't display arbitrary messages.
  redirect(`/dashboard/${slug}/bookings/${bookingId}?notice=cancelled-${refundStatus}`);
}

export async function saveSettings(
  slug: string,
  _p: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const res = await runAction("saveSettings", async () => {
    const ctx = await requireTenant(slug, "settings:manage");
    await updateTenantSettings(ctx, {
      name: formString(fd, "name"),
      timezone: formString(fd, "timezone"),
      brandColor: formString(fd, "brandColor"),
      cancellationWindowHours: int(fd, "cancellationWindowHours"),
    });
    return { ok: true, message: "Settings saved" } as const;
  });
  revalidatePath(`/dashboard/${slug}`, "layout");
  // The public booking page is cached (ISR); name, color and timezone changes must show at once.
  revalidatePath(`/b/${slug}`);
  return res;
}

export async function addMemberAction(
  slug: string,
  _p: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const res = await runAction("addMember", async () => {
    const ctx = await requireTenant(slug, "members:manage");
    await addMember(ctx, { email: formString(fd, "email"), role: formString(fd, "role") });
    return { ok: true, message: "Member added. They can sign in with that email." } as const;
  });
  revalidatePath(`/dashboard/${slug}/settings`);
  return res;
}

export async function removeMemberAction(slug: string, membershipId: string) {
  const ctx = await requireTenant(slug, "members:manage");
  await removeMember(ctx, membershipId);
  revalidatePath(`/dashboard/${slug}/settings`);
}

export async function upgradeAction(slug: string) {
  const ctx = await requireTenant(slug, "billing:manage");
  redirect(await startUpgrade(ctx));
}

export async function billingPortalAction(slug: string) {
  const ctx = await requireTenant(slug, "billing:manage");
  redirect(await openBillingPortal(ctx));
}
