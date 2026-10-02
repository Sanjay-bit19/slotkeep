import { notFound } from "next/navigation";
import { fakePaymentsEnabled } from "@/lib/dev";
import { cancelFakeSub } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Test billing portal", robots: { index: false } };

export default async function FakePortal({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; return?: string }>;
}) {
  if (!fakePaymentsEnabled()) notFound();
  const { customer, return: ret } = await searchParams;
  if (!customer) notFound();
  const returnUrl =
    ret && ret.startsWith(process.env.APP_URL ?? "http://localhost:3000") ? ret : "/dashboard";
  return (
    <main id="main" className="mx-auto max-w-md px-5 py-16">
      <div className="rounded-xl border-2 border-dashed border-amber-400 bg-white p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          Test mode · billing portal simulator
        </p>
        <h1 className="mt-2 text-2xl font-bold">SlotKeep Pro</h1>
        <form action={cancelFakeSub.bind(null, customer, returnUrl)} className="mt-6">
          <button
            type="submit"
            className="h-11 w-full rounded-md bg-red-600 font-semibold text-white"
          >
            Cancel subscription now
          </button>
        </form>
        <a href={returnUrl} className="mt-4 block text-center text-sm underline">
          Return
        </a>
      </div>
    </main>
  );
}
