import Link from "next/link";
import { formatTimeOfDay } from "@slotkeep/core";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { pageTenant } from "@/lib/page-auth";
import { usageFor } from "@/lib/services/billing";

export const metadata = { title: "Staff" };
const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function StaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { slug } = await params;
  const { saved } = await searchParams;
  const ctx = await pageTenant(slug, "staff:manage");
  const [staff, usage] = await Promise.all([
    ctx.db.staffMember.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        availability: { orderBy: { weekday: "asc" } },
        services: { include: { service: { select: { name: true } } } },
      },
    }),
    usageFor(ctx),
  ]);
  const atLimit = usage.staffLimit !== null && usage.activeStaff >= usage.staffLimit;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Staff</h1>
        <Button asChild>
          <Link href={`/dashboard/${slug}/staff/new`}>Add staff member</Link>
        </Button>
      </div>
      {saved && <Alert variant="success">Staff member saved.</Alert>}
      {atLimit && (
        <Alert variant="info">
          The Free plan includes {usage.staffLimit} active staff member.{" "}
          <Link className="font-medium underline" href={`/dashboard/${slug}/billing`}>
            Upgrade to Pro
          </Link>{" "}
          to add more.
        </Alert>
      )}
      <ul className="flex flex-col gap-3">
        {staff.map((s) => (
          <li key={s.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">
                  {s.name}{" "}
                  {!s.active && (
                    <span className="text-sm font-normal text-slate-600">(inactive)</span>
                  )}
                </h2>
                <p className="text-sm text-slate-700">
                  {s.availability.length
                    ? s.availability
                        .map(
                          (a) =>
                            `${DAY[a.weekday]} ${formatTimeOfDay(a.startMinute)}-${formatTimeOfDay(a.endMinute)}`,
                        )
                        .join(", ")
                    : "No hours set"}
                </p>
                <p className="text-xs text-slate-600">
                  {s.services.map((x) => x.service.name).join(", ") || "No services"}
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href={`/dashboard/${slug}/staff/${s.id}`} aria-label={`Edit ${s.name}`}>
                  Edit
                </Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
