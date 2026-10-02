import Link from "next/link";
import { formatInTimeZone, formatMoney } from "@slotkeep/core";
import { STATUS_LABEL, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listBookings } from "@/lib/data";
import { pageTenant } from "@/lib/page-auth";

export const metadata = { title: "Bookings" };

export default async function BookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await pageTenant(slug, "booking:read");
  const clean = Object.fromEntries(Object.entries(sp).filter(([, v]) => v));
  const parsed = await listBookings(ctx, clean).catch(() => listBookings(ctx, {}));
  const { rows, total, pages, filters } = parsed;
  const staff = await ctx.db.staffMember.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const tz = ctx.tenant.timezone;
  const qs = (page: number) => new URLSearchParams({ ...clean, page: String(page) }).toString();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">Bookings</h1>
      <form
        method="get"
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6"
        aria-label="Filter bookings"
      >
        <div className="flex flex-col gap-1 lg:col-span-2">
          <Label htmlFor="q">Customer</Label>
          <Input id="q" name="q" placeholder="Name or email" defaultValue={filters.q ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={filters.status ?? ""}>
            <option value="">Any</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="staffId">Staff</Label>
          <Select id="staffId" name="staffId" defaultValue={filters.staffId ?? ""}>
            <option value="">Anyone</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={filters.from ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={filters.to ?? ""} />
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit">Apply filters</Button>
          <Button asChild variant="ghost">
            <Link href={`/dashboard/${slug}/bookings`}>Reset</Link>
          </Button>
        </div>
      </form>

      <p className="text-sm text-slate-600" aria-live="polite">
        {total} booking{total === 1 ? "" : "s"}
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Bookings</caption>
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                When
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Customer
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Service
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Staff
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Deposit
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-600">
                  No bookings match these filters.
                </td>
              </tr>
            )}
            {rows.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3">
                  <Link
                    className="font-medium text-brand underline-offset-2 hover:underline"
                    href={`/dashboard/${slug}/bookings/${b.id}`}
                  >
                    {formatInTimeZone(b.startAt, tz, "ccc LLL d, h:mm a")}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {b.customer.name}
                  <span className="block text-xs text-slate-600">{b.customer.email}</span>
                </td>
                <td className="px-4 py-3">{b.service.name}</td>
                <td className="px-4 py-3">{b.staff.name}</td>
                <td className="px-4 py-3">
                  {formatMoney(b.depositPaidCents, b.currency)}
                  {b.refundedCents > 0 && (
                    <span className="block text-xs text-slate-600">
                      refunded {formatMoney(b.refundedCents, b.currency)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={b.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-2">
          {filters.page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={`?${qs(filters.page - 1)}`}>Previous</Link>
            </Button>
          )}
          <span className="text-sm text-slate-700">
            Page {filters.page} of {pages}
          </span>
          {filters.page < pages && (
            <Button asChild variant="outline" size="sm">
              <Link href={`?${qs(filters.page + 1)}`}>Next</Link>
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}
