import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pageUser } from "@/lib/page-auth";
import { env } from "@slotkeep/infra";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Create your business" };

export default async function OnboardingPage() {
  await pageUser("/onboarding");
  const timezones = Intl.supportedValuesOf("timeZone");
  return (
    <main id="main" className="mx-auto max-w-lg px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="text-2xl">Set up your business</span>
          </CardTitle>
          <CardDescription>
            Step 1 of 3. Next you&apos;ll add services and staff hours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm timezones={timezones} appUrl={env().APP_URL} />
        </CardContent>
      </Card>
    </main>
  );
}
