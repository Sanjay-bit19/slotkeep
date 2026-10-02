import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { toLocalDate } from "@slotkeep/core";
import { forTenant } from "@slotkeep/db";
import { BookingWidget } from "@/components/booking-widget";
import { findPublicTenant } from "@/lib/services/public-booking";

// Catalog data changes rarely; slots are fetched live on the client. Cache the shell briefly.
export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const tenant = await findPublicTenant((await params).slug);
  return tenant
    ? {
        title: `Book with ${tenant.name}`,
        description: `Book an appointment with ${tenant.name} online.`,
      }
    : { title: "Not found" };
}

export default async function PublicBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await findPublicTenant(slug);
  if (!tenant) notFound();
  const db = forTenant(tenant.id);
  const [services, staff] = await Promise.all([
    db.service.findMany({
      where: { active: true, staff: { some: { staff: { active: true } } } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        durationMin: true,
        priceCents: true,
        depositCents: true,
        currency: true,
      },
    }),
    db.staffMember.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, services: { select: { serviceId: true } } },
    }),
  ]);

  return (
    <div style={{ ["--brand" as string]: tenant.brandColor }} className="min-h-screen">
      <header className="bg-brand">
        <div className="mx-auto max-w-3xl px-5 py-8">
          <p className="text-sm text-white/90">Online booking</p>
          <h1 className="text-3xl font-bold text-white">{tenant.name}</h1>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-5 py-8">
        <BookingWidget
          slug={tenant.slug}
          timezone={tenant.timezone}
          today={toLocalDate(new Date(), tenant.timezone)}
          services={services}
          staff={staff.map((s) => ({
            id: s.id,
            name: s.name,
            serviceIds: s.services.map((x) => x.serviceId),
          }))}
        />
      </main>
      <footer className="pb-8 text-center text-xs text-slate-600">
        Powered by SlotKeep · Free cancellation up to {tenant.cancellationWindowHours}h before your
        appointment
      </footer>
    </div>
  );
}
