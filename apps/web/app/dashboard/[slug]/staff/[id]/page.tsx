import { notFound } from "next/navigation";
import { formatInTimeZone, formatTimeOfDay } from "@slotkeep/core";
import { StaffForm } from "@/components/staff-form";
import { TimeOffForm } from "@/components/time-off-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pageTenant } from "@/lib/page-auth";
import { addTimeOffAction, deleteTimeOffAction, saveStaff } from "../../actions";

export const metadata = { title: "Edit staff member" };

export default async function EditStaffPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const ctx = await pageTenant(slug, "staff:manage");
  const s = await ctx.db.staffMember.findUnique({
    where: { id },
    include: {
      availability: true,
      services: true,
      timeOff: { where: { endAt: { gt: new Date() } }, orderBy: { startAt: "asc" } },
    },
  });
  if (!s) notFound();
  const services = await ctx.db.service.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  // The form edits one window per day; the first window wins if there are several.
  const hours: Record<number, [string, string]> = {};
  for (const a of [...s.availability].sort((x, y) => x.startMinute - y.startMinute)) {
    hours[a.weekday] ??= [formatTimeOfDay(a.startMinute), formatTimeOfDay(a.endMinute)];
  }
  const tz = ctx.tenant.timezone;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="text-2xl">{s.name}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StaffForm
            action={saveStaff.bind(null, slug, s.id)}
            services={services}
            values={{
              name: s.name,
              email: s.email ?? "",
              active: s.active,
              serviceIds: s.services.map((x) => x.serviceId),
              hours,
            }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Time off</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-slate-600">Times are in {tz.replaceAll("_", " ")}.</p>
          {s.timeOff.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {s.timeOff.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {formatInTimeZone(t.startAt, tz, "LLL d h:mm a")} –{" "}
                    {formatInTimeZone(t.endAt, tz, "LLL d h:mm a")}
                    {t.reason ? ` · ${t.reason}` : ""}
                  </span>
                  <form action={deleteTimeOffAction.bind(null, slug, s.id, t.id)}>
                    <Button size="sm" variant="ghost" type="submit" aria-label="Remove time off">
                      Remove
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <TimeOffForm action={addTimeOffAction.bind(null, slug, s.id)} />
        </CardContent>
      </Card>
    </div>
  );
}
