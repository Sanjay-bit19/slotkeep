import Link from "next/link";
import { DateTime } from "luxon";
import { formatInTimeZone, localDateSchema } from "@slotkeep/core";
import { Button } from "@/components/ui/button";
import { calendarBookings, todayLocal } from "@/lib/data";
import { pageTenant } from "@/lib/page-auth";
import { cn } from "@/lib/utils";

export const metadata = { title: "Calendar" };

const HOUR_PX = 56;
const STATUS_COLORS: Record<string, string> = {
  PENDING_PAYMENT: "border-amber-500 bg-amber-50 text-amber-950",
  CONFIRMED: "border-brand bg-white text-slate-900",
  COMPLETED: "border-sky-600 bg-sky-50 text-sky-950",
  NO_SHOW: "border-red-600 bg-red-50 text-red-950",
};

export default async function CalendarPage({
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
  const view = sp.view === "day" ? "day" : "week";
  const date = localDateSchema.safeParse(sp.date).success ? sp.date! : todayLocal(tz);
  const anchor = DateTime.fromISO(date, { zone: tz });
  const start = view === "week" ? anchor.startOf("week") : anchor.startOf("day");
  const days = Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => start.plus({ days: i }));
  const fromDate = days[0]!.toISODate()!;
  const toDate = days[days.length - 1]!.toISODate()!;

  const [bookings, staff] = await Promise.all([
    calendarBookings(ctx, fromDate, toDate),
    ctx.db.staffMember.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Visible hours: 8:00-20:00, widened to fit any booking outside that range.
  let firstHour = 8;
  let lastHour = 20;
  for (const b of bookings) {
    const s = DateTime.fromJSDate(b.startAt, { zone: tz });
    const e = DateTime.fromJSDate(b.endAt, { zone: tz });
    firstHour = Math.min(firstHour, s.hour);
    lastHour = Math.max(lastHour, e.hour + (e.minute > 0 ? 1 : 0));
  }
  lastHour = Math.min(24, lastHour);
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);

  // Columns: days (week view) or staff members (day view).
  const columns =
    view === "week"
      ? days.map((d) => ({
          key: d.toISODate()!,
          label: d.toFormat("ccc d"),
          match: (b: (typeof bookings)[number]) =>
            formatInTimeZone(b.startAt, tz, "yyyy-MM-dd") === d.toISODate(),
        }))
      : staff.map((s) => ({
          key: s.id,
          label: s.name,
          match: (b: (typeof bookings)[number]) => b.staff.id === s.id,
        }));

  const step = view === "week" ? { weeks: 1 } : { days: 1 };
  const prev = start.minus(step).toISODate();
  const next = start.plus(step).toISODate();
  const base = `/dashboard/${slug}/calendar`;
  const title =
    view === "week"
      ? `${days[0]!.toFormat("LLL d")} – ${days[6]!.toFormat("LLL d, yyyy")}`
      : anchor.toFormat("cccc, LLLL d, yyyy");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Calendar</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="View"
            className="flex rounded-md border border-slate-300 bg-white p-0.5"
          >
            {(["day", "week"] as const).map((v) => (
              <Link
                key={v}
                href={`${base}?view=${v}&date=${date}`}
                aria-current={view === v ? "page" : undefined}
                className={cn(
                  "rounded px-3 py-1.5 text-sm capitalize",
                  view === v ? "bg-brand text-white" : "text-slate-700",
                )}
              >
                {v}
              </Link>
            ))}
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`${base}?view=${view}&date=${prev}`} aria-label={`Previous ${view}`}>
              ←
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`${base}?view=${view}&date=${todayLocal(tz)}`}>Today</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`${base}?view=${view}&date=${next}`} aria-label={`Next ${view}`}>
              →
            </Link>
          </Button>
        </div>
      </div>
      <p className="text-sm text-slate-700">
        <span className="font-medium">{title}</span> · times in {tz.replaceAll("_", " ")}
      </p>

      {columns.length === 0 ? (
        <p className="text-sm text-slate-600">Add an active staff member to see the day view.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div
            className="grid min-w-[720px]"
            style={{ gridTemplateColumns: `4rem repeat(${columns.length}, minmax(0, 1fr))` }}
          >
            <div className="border-b border-slate-200" />
            {columns.map((c) => (
              <div
                key={c.key}
                className="border-b border-l border-slate-200 px-2 py-2 text-center text-sm font-medium text-slate-800"
              >
                {c.label}
              </div>
            ))}
            <div className="relative" style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h, i) => (
                <div
                  key={h}
                  className="absolute right-2 text-xs text-slate-500"
                  style={{ top: i * HOUR_PX - 6 }}
                >
                  {DateTime.fromObject({ hour: h % 24 }).toFormat("h a")}
                </div>
              ))}
            </div>
            {columns.map((c) => (
              <div
                key={c.key}
                className="relative border-l border-slate-200"
                style={{ height: hours.length * HOUR_PX }}
              >
                {hours.map((h, i) => (
                  <div
                    key={h}
                    aria-hidden
                    className="absolute inset-x-0 border-t border-slate-100"
                    style={{ top: i * HOUR_PX }}
                  />
                ))}
                <ul aria-label={`Bookings for ${c.label}`}>
                  {bookings.filter(c.match).map((b) => {
                    const s = DateTime.fromJSDate(b.startAt, { zone: tz });
                    const top = ((s.hour - firstHour) * 60 + s.minute) * (HOUR_PX / 60);
                    const height = Math.max(
                      22,
                      ((b.endAt.getTime() - b.startAt.getTime()) / 60_000) * (HOUR_PX / 60) - 2,
                    );
                    return (
                      <li key={b.id} className="absolute inset-x-1" style={{ top, height }}>
                        <Link
                          href={`/dashboard/${slug}/bookings/${b.id}`}
                          className={cn(
                            "block h-full overflow-hidden rounded-md border-l-4 px-2 py-1 text-xs shadow-sm hover:shadow",
                            STATUS_COLORS[b.status],
                          )}
                          aria-label={`${s.toFormat("h:mm a")} ${b.customer.name}, ${b.service.name} with ${b.staff.name}`}
                        >
                          <span className="font-semibold">{s.toFormat("h:mm")}</span>{" "}
                          {b.customer.name}
                          <span className="block truncate text-slate-600">
                            {b.service.name}
                            {view === "week" ? ` · ${b.staff.name}` : ""}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
