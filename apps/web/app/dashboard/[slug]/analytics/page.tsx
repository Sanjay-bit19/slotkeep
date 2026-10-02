import { formatMoney } from "@slotkeep/core";
import { DateTime } from "luxon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { analyticsFor } from "@/lib/data";
import { pageTenant } from "@/lib/page-auth";

export const metadata = { title: "Analytics" };

function BarChart({
  title,
  data,
  format,
}: {
  title: string;
  data: Array<{ label: string; value: number }>;
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure>
      <figcaption className="mb-3 text-sm font-medium text-slate-800">{title}</figcaption>
      <div className="flex h-48 items-end gap-1.5" aria-hidden>
        {data.map((d) => (
          <div key={d.label} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] text-slate-600">{d.value ? format(d.value) : ""}</span>
            <div
              className="w-full rounded-t bg-brand"
              style={{ height: `${(d.value / max) * 85}%`, minHeight: d.value ? 2 : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5" aria-hidden>
        {data.map((d) => (
          <span key={d.label} className="flex-1 text-center text-[10px] text-slate-600">
            {d.label}
          </span>
        ))}
      </div>
      {/* Accessible equivalent of the chart. */}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export default async function AnalyticsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await pageTenant(slug, "analytics:read");
  const a = await analyticsFor(ctx);
  const label = (ws: string) => DateTime.fromISO(ws).toFormat("LLL d");
  const kpis = [
    { label: "Bookings (12 weeks)", value: String(a.totalBookings) },
    { label: "Net deposits collected", value: formatMoney(a.revenue.netDepositCents) },
    { label: "Completed service value", value: formatMoney(a.revenue.completedServiceValueCents) },
    {
      label: "No-show rate",
      value: a.noShowRate === null ? "n/a" : `${(a.noShowRate * 100).toFixed(1)}%`,
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-6">
              <p className="text-sm text-slate-600">{k.label}</p>
              <p className="mt-1 text-2xl font-bold">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Last 12 weeks</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-8 lg:grid-cols-2">
          <BarChart
            title="Bookings per week"
            data={a.weeks.map((w) => ({ label: label(w.weekStart), value: w.bookings }))}
            format={String}
          />
          <BarChart
            title="Net deposit revenue per week"
            data={a.weeks.map((w) => ({ label: label(w.weekStart), value: w.depositRevenueCents }))}
            format={(c) => formatMoney(c).replace(/\.00$/, "")}
          />
        </CardContent>
      </Card>
      <p className="text-xs text-slate-600">
        No-show rate = no-shows ÷ (completed + no-shows), by appointment date in{" "}
        {ctx.tenant.timezone.replaceAll("_", " ")}. Revenue counts deposits captured online minus
        refunds.
      </p>
    </div>
  );
}
