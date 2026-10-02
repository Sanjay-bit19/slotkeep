import { ActionForm } from "@/components/simple-action-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { pageTenant } from "@/lib/page-auth";
import { listMembers } from "@/lib/services/tenants";
import { addMemberAction, removeMemberAction, saveSettings } from "../actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await pageTenant(slug, "settings:manage");
  const members = await listMembers(ctx);
  const t = ctx.tenant;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Business</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={saveSettings.bind(null, slug)}
            submitLabel="Save settings"
            className="grid gap-4 sm:grid-cols-2"
          >
            <Field id="name" label="Business name">
              <Input id="name" name="name" defaultValue={t.name} required />
            </Field>
            <Field
              id="timezone"
              label="Time zone"
              hint="Changing this reinterprets weekly hours; existing bookings keep their exact times."
            >
              <Select id="timezone" name="timezone" defaultValue={t.timezone}>
                {Intl.supportedValuesOf("timeZone").map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="brandColor" label="Brand color">
              <Input
                id="brandColor"
                name="brandColor"
                type="color"
                defaultValue={t.brandColor}
                className="h-10 w-20 p-1"
              />
            </Field>
            <Field
              id="cancellationWindowHours"
              label="Free cancellation window (hours)"
              hint="Customers cancelling later than this keep no deposit refund."
            >
              <Input
                id="cancellationWindowHours"
                name="cancellationWindowHours"
                type="number"
                min={0}
                max={168}
                defaultValue={t.cancellationWindowHours}
              />
            </Field>
          </ActionForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Team members</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="divide-y divide-slate-100">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {m.user.name ?? m.user.email}{" "}
                  <span className="text-slate-600">({m.user.email})</span> · {m.role.toLowerCase()}
                </span>
                {m.userId !== ctx.user.id && (
                  <form action={removeMemberAction.bind(null, slug, m.id)}>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="submit"
                      aria-label={`Remove ${m.user.email}`}
                    >
                      Remove
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <ActionForm
            action={addMemberAction.bind(null, slug)}
            submitLabel="Add member"
            className="grid gap-3 sm:grid-cols-3 sm:items-end"
          >
            <Field id="member-email" label="Email">
              <Input id="member-email" name="email" type="email" required />
            </Field>
            <Field id="member-role" label="Role">
              <Select id="member-role" name="role" defaultValue="STAFF">
                <option value="STAFF">Staff (calendar and bookings)</option>
                <option value="OWNER">Owner (everything)</option>
              </Select>
            </Field>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
