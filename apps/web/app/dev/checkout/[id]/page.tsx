import { notFound } from "next/navigation";
import { formatMoney } from "@slotkeep/core";
import { getFakeSession } from "@slotkeep/infra";
import { fakePaymentsEnabled } from "@/lib/dev";
import { payFakeSession } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Test checkout", robots: { index: false } };

/** Stand-in for Stripe's hosted checkout when PAYMENTS_MODE=fake. Clearly labelled as a simulator. */
export default async function FakeCheckout({ params }: { params: Promise<{ id: string }> }) {
  if (!fakePaymentsEnabled()) notFound();
  const { id } = await params;
  const s = await getFakeSession(id);
  if (!s) notFound();
  return (
    <main id="main" className="mx-auto max-w-md px-5 py-16">
      <div className="rounded-xl border-2 border-dashed border-amber-400 bg-white p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          Test mode · payment simulator
        </p>
        <h1 className="mt-2 text-2xl font-bold">{s.productName}</h1>
        <p className="mt-1 text-sm text-slate-600">{s.customerEmail}</p>
        <p className="mt-6 text-4xl font-bold">{formatMoney(s.amountCents, s.currency)}</p>
        {s.status !== "open" ? (
          <p role="alert" className="mt-6 rounded-md bg-red-50 p-3 text-sm text-red-900">
            This checkout session has{" "}
            {s.status === "expired" ? "expired" : "already been completed"}.
          </p>
        ) : (
          <form action={payFakeSession.bind(null, s.id)} className="mt-6">
            <button
              type="submit"
              className="h-12 w-full rounded-md bg-indigo-600 font-semibold text-white hover:bg-indigo-700"
            >
              Pay {formatMoney(s.amountCents, s.currency)}
            </button>
          </form>
        )}
        <a href={s.cancelUrl} className="mt-4 block text-center text-sm text-slate-700 underline">
          Cancel and go back
        </a>
        <p className="mt-6 text-xs text-slate-600">
          No real payment happens. Paying sends a signed <code>checkout.session.completed</code>{" "}
          webhook to this app, exercising the same code path as Stripe.
        </p>
      </div>
    </main>
  );
}
