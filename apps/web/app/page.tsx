import Link from "next/link";
import { CalendarCheck, CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { demoLoginEnabled } from "@/lib/demo";

export default function Home() {
  const demo = demoLoginEnabled();
  return (
    <div>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-bold text-slate-900">SlotKeep</span>
        <nav aria-label="Main">
          <Button asChild variant="ghost">
            <Link href="/login">Sign in</Link>
          </Button>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-6 pb-24 pt-12">
        <section className="max-w-2xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Bookings and deposits for small service businesses
          </h1>
          <p className="mt-6 text-lg text-slate-700">
            Give customers a booking page that never double-books, takes a deposit up front, and
            reminds them the day before. Built for salons, tutors, trainers and clinics.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/login?callbackUrl=/onboarding">Create your booking page</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/b/shear-bliss">See a demo booking page</Link>
            </Button>
            {demo && (
              <Button asChild size="lg" variant="secondary">
                <a href="/api/demo-login?as=owner">Open the demo dashboard</a>
              </Button>
            )}
          </div>
        </section>
        <section aria-labelledby="features" className="mt-20 grid gap-6 sm:grid-cols-3">
          <h2 id="features" className="sr-only">
            Features
          </h2>
          {[
            {
              icon: CalendarCheck,
              title: "No double bookings",
              body: "Conflicts are rejected by the database itself, not just the UI.",
            },
            {
              icon: CreditCard,
              title: "Deposits via Stripe",
              body: "Slots are held for 10 minutes during checkout and confirmed by Stripe webhooks.",
            },
            {
              icon: ShieldCheck,
              title: "Self-service links",
              body: "Customers cancel or reschedule from a signed, expiring link in their email.",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-6">
              <f.icon aria-hidden className="h-6 w-6 text-brand" />
              <h3 className="mt-4 font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-700">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
