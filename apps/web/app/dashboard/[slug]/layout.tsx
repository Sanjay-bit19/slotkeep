import Link from "next/link";
import { DashboardNav, type NavItem } from "@/components/dashboard-nav";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/authz";
import { pageTenant } from "@/lib/page-auth";
import { signOutAction } from "./sign-out";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await pageTenant(slug, "booking:read");
  const base = `/dashboard/${slug}`;
  const items: NavItem[] = [
    { href: base, label: "Overview" },
    { href: `${base}/calendar`, label: "Calendar" },
    { href: `${base}/bookings`, label: "Bookings" },
  ];
  if (can(ctx.role, "catalog:manage")) items.push({ href: `${base}/services`, label: "Services" });
  if (can(ctx.role, "staff:manage")) items.push({ href: `${base}/staff`, label: "Staff" });
  if (can(ctx.role, "analytics:read"))
    items.push({ href: `${base}/analytics`, label: "Analytics" });
  if (can(ctx.role, "billing:manage")) items.push({ href: `${base}/billing`, label: "Billing" });
  if (can(ctx.role, "settings:manage")) items.push({ href: `${base}/settings`, label: "Settings" });

  return (
    <div style={{ ["--brand" as string]: ctx.tenant.brandColor }}>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="font-bold text-slate-900">
              SlotKeep
            </Link>
            <span aria-hidden className="text-slate-300">
              /
            </span>
            <span className="font-medium text-slate-800">{ctx.tenant.name}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {ctx.plan === "PRO" ? "Pro" : "Free"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={`/b/${ctx.tenant.slug}`} target="_blank" rel="noreferrer">
                View booking page
              </a>
            </Button>
            <form action={signOutAction}>
              <Button size="sm" variant="ghost" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="md:w-48 md:shrink-0">
          <DashboardNav items={items} />
        </aside>
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
