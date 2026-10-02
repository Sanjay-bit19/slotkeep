import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listMemberships } from "@/lib/authz";
import { pageUser } from "@/lib/page-auth";

export const metadata = { title: "Your businesses" };

export default async function DashboardIndex() {
  const user = await pageUser();
  const memberships = await listMemberships(user.id);
  if (memberships.length === 0) redirect("/onboarding");
  if (memberships.length === 1) redirect(`/dashboard/${memberships[0]!.tenant.slug}`);
  return (
    <main id="main" className="mx-auto max-w-lg px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Choose a business</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {memberships.map((m) => (
              <li key={m.id}>
                <Link
                  className="flex justify-between rounded-md border border-slate-200 p-3 hover:bg-slate-50"
                  href={`/dashboard/${m.tenant.slug}`}
                >
                  <span className="font-medium">{m.tenant.name}</span>
                  <span className="text-sm text-slate-600">{m.role.toLowerCase()}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" className="mt-4 w-full">
            <Link href="/onboarding">Create another business</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
