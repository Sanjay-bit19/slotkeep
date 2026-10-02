import { ServiceForm } from "@/components/service-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pageTenant } from "@/lib/page-auth";
import { saveService } from "../../actions";

export const metadata = { title: "New service" };

export default async function NewServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await pageTenant(slug, "catalog:manage");
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="text-2xl">New service</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ServiceForm
          action={saveService.bind(null, slug, null)}
          values={{
            name: "",
            description: "",
            durationMin: 60,
            bufferMin: 0,
            price: "50.00",
            deposit: "10.00",
            active: true,
          }}
        />
      </CardContent>
    </Card>
  );
}
