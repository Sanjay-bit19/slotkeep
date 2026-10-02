import { notFound } from "next/navigation";
import { ServiceForm } from "@/components/service-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pageTenant } from "@/lib/page-auth";
import { saveService } from "../../actions";

export const metadata = { title: "Edit service" };

const dollars = (cents: number) => (cents / 100).toFixed(2);

export default async function EditServicePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const ctx = await pageTenant(slug, "catalog:manage");
  const s = await ctx.db.service.findUnique({ where: { id } });
  if (!s) notFound();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="text-2xl">Edit {s.name}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ServiceForm
          action={saveService.bind(null, slug, s.id)}
          values={{
            name: s.name,
            description: s.description,
            durationMin: s.durationMin,
            bufferMin: s.bufferMin,
            price: dollars(s.priceCents),
            deposit: dollars(s.depositCents),
            active: s.active,
          }}
        />
      </CardContent>
    </Card>
  );
}
