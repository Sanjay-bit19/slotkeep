import Link from "next/link";
import { formatMoney } from "@slotkeep/core";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { pageTenant } from "@/lib/page-auth";

export const metadata = { title: "Services" };

export default async function ServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { slug } = await params;
  const { saved } = await searchParams;
  const ctx = await pageTenant(slug, "catalog:manage");
  const services = await ctx.db.service.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { staff: true } } },
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Services</h1>
        <Button asChild>
          <Link href={`/dashboard/${slug}/services/new`}>Add service</Link>
        </Button>
      </div>
      {saved && <Alert variant="success">Service saved.</Alert>}
      {services.length === 0 ? (
        <p className="text-sm text-slate-600">No services yet. Add one so customers can book.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {services.map((s) => (
            <li key={s.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-slate-900">{s.name}</h2>
                  <p className="text-sm text-slate-700">
                    {s.durationMin} min{s.bufferMin ? ` + ${s.bufferMin} min buffer` : ""} ·{" "}
                    {formatMoney(s.priceCents, s.currency)} · deposit{" "}
                    {formatMoney(s.depositCents, s.currency)}
                  </p>
                  <p className="text-xs text-slate-600">
                    {s.active ? "Bookable" : "Hidden"} · {s._count.staff} staff
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/dashboard/${slug}/services/${s.id}`} aria-label={`Edit ${s.name}`}>
                    Edit
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
