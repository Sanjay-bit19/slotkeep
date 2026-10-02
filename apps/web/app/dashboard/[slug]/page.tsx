import Link from "next/link";
import { formatInTimeZone } from "@slotkeep/core";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/authz";
import { calendarBookings, todayLocal } from "@/lib/data";
import { pageTenant } from "@/lib/page-auth";
import { usageFor } from "@/lib/services/billing";

export const metadata = { title: "Overview" };

export default async function Overview({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await pageTenant(slug, "booking:read");
  const tz = ctx.tenant.timezone;
  const today = todayLocal(tz);
  const [todays, services, staffWithHours, linked, usage] = await Promise.all([
    calendarBookings(ctx, today, today),
    ctx.db.service.count({ where: { active: true } }),
    ctx.db.staffMember.count({ where: { active: true, availability: { some: {} } } }),
    ctx.db.staffService.count(),
    usageFor(ctx),
  ]);
  const isOwner = can(ctx.role, "catalog:manage");
  const setup = [
    { done: true, label: "Create your business", href: null },
    { done: services > 0, label: "Add a service", href: `/dashboard/${slug}/services/new` },
    {
      done: staffWithHours > 0 && linked > 0,
      label: "Set staff hours and services",
      href: `/dashboard/${slug}/staff`,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
      {sp.welcome && (
        <Alert variant="success">
          Your business is ready. Finish the setup steps below to start taking bookings.
        </Alert>
      )}
      {sp.denied && (
        <Alert variant="warning">You don&apos;t have permission to view that page.</Alert>
      )}

      {isOwner && setup.some((s) => !s.done) && (
        <Card>
          <CardHeader>
            <CardTitle>Get set up</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2">
              {setup.map((s, i) => (
                <li key={s.label} className="flex items-center gap-3 text-sm">
                  <span
                    aria-hidden
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"}`}
                  >
                    {s.done ? "✓" : i + 1}
                  </span>
                  {s.href && !s.done ? (
                    <Link className="font-medium text-brand underline" href={s.href}>
                      {s.label}
                    </Link>
                  ) : (
                    <span className={s.done ? "text-slate-500 line-through" : ""}>{s.label}</span>
                  )}
                  <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-slate-600">Appointments today</p>
            <p className="mt-1 text-3xl font-bold">{todays.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-slate-600">Bookings this month</p>
            <p className="mt-1 text-3xl font-bold">
              {usage.monthBookings}
              {usage.bookingLimit !== null && (
                <span className="text-base font-normal text-slate-600">
                  {" "}
                  / {usage.bookingLimit}
                </span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-slate-600">Active staff</p>
            <p className="mt-1 text-3xl font-bold">
              {usage.activeStaff}
              {usage.staffLimit !== null && (
                <span className="text-base font-normal text-slate-600"> / {usage.staffLimit}</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
        </CardHeader>
        <CardContent>
          {todays.length === 0 ? (
            <p className="text-sm text-slate-600">No appointments today.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {todays.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/dashboard/${slug}/bookings/${b.id}`}
                    className="flex items-center justify-between gap-4 py-3 hover:bg-slate-50"
                  >
                    <span className="w-20 font-mono text-sm">
                      {formatInTimeZone(b.startAt, tz, "h:mm a")}
                    </span>
                    <span className="flex-1 text-sm">
                      <span className="font-medium">{b.customer.name}</span> · {b.service.name} ·{" "}
                      {b.staff.name}
                    </span>
                    <StatusBadge status={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
