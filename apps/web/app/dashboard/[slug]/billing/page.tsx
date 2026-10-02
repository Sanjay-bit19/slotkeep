import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pageTenant } from "@/lib/page-auth";
import { usageFor } from "@/lib/services/billing";
import { billingPortalAction, upgradeAction } from "../actions";

export const metadata = { title: "Billing" };

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="font-medium">
          {limit === null ? `${used} (unlimited)` : `${used} / ${limit}`}
        </span>
      </div>
      {limit !== null && (
        <div
          className="mt-1 h-2 rounded-full bg-slate-100"
          role="progressbar"
          aria-label={label}
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={limit}
        >
          <div
            className={`h-2 rounded-full ${pct >= 90 ? "bg-red-600" : "bg-brand"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ upgraded?: string }>;
}) {
  const { slug } = await params;
  const { upgraded } = await searchParams;
  const ctx = await pageTenant(slug, "billing:manage");
  const usage = await usageFor(ctx);
  const t = ctx.tenant;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">Billing</h1>
      {upgraded && ctx.plan !== "PRO" && (
        <Alert variant="info">
          Payment received. Your plan will update as soon as Stripe confirms it (usually a few
          seconds). Refresh this page.
        </Alert>
      )}
      {upgraded && ctx.plan === "PRO" && (
        <Alert variant="success">You&apos;re on Pro. Thanks!</Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Current plan: {ctx.plan === "PRO" ? "Pro" : "Free"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-slate-700">
            {ctx.plan === "PRO"
              ? `Unlimited staff and bookings. Subscription status: ${t.subscriptionStatus.toLowerCase().replace("_", " ")}${t.currentPeriodEnd ? `, current period ends ${t.currentPeriodEnd.toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}.`
              : "Free includes 1 active staff member and 50 bookings per month. Pro is $29/month for unlimited staff and bookings."}
          </p>
          <Meter label="Active staff" used={usage.activeStaff} limit={usage.staffLimit} />
          <Meter
            label="Bookings this month"
            used={usage.monthBookings}
            limit={usage.bookingLimit}
          />
          <div className="flex gap-2">
            {ctx.plan !== "PRO" && (
              <form action={upgradeAction.bind(null, slug)}>
                <Button type="submit">Upgrade to Pro</Button>
              </form>
            )}
            {t.stripeCustomerId && (
              <form action={billingPortalAction.bind(null, slug)}>
                <Button type="submit" variant="outline">
                  Manage subscription
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
