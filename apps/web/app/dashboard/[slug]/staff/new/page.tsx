import { StaffForm } from "@/components/staff-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pageTenant } from "@/lib/page-auth";
import { saveStaff } from "../../actions";

export const metadata = { title: "New staff member" };

export default async function NewStaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await pageTenant(slug, "staff:manage");
  const services = await ctx.db.service.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const weekdays = Object.fromEntries(
    [1, 2, 3, 4, 5].map((d) => [d, ["09:00", "17:00"] as [string, string]]),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="text-2xl">New staff member</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <StaffForm
          action={saveStaff.bind(null, slug, null)}
          services={services}
          values={{
            name: "",
            email: "",
            active: true,
            serviceIds: services.map((s) => s.id),
            hours: weekdays,
          }}
        />
      </CardContent>
    </Card>
  );
}
