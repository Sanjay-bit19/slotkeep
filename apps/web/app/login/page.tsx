import Link from "next/link";
import { googleEnabled } from "@/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { demoLoginEnabled } from "@/lib/demo";
import { devMailboxEnabled } from "@/lib/dev";
import { signInWithGoogle } from "./actions";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

/**
 * Auth.js redirects here with ?error=<code>. "Configuration" covers server-side failures, most
 * often the sign-in email failing to send, so it must not be reported as a bad link.
 */
function errorMessage(code: string): string {
  switch (code) {
    case "Verification":
      return "That sign-in link is invalid, expired, or was already used. Request a new one.";
    case "Configuration":
      return "We couldn't send the sign-in email. Please try again in a moment.";
    case "AccessDenied":
      return "Sign-in was denied for this account.";
    case "OAuthAccountNotLinked":
      return "This email is already linked to a different sign-in method. Use the email link instead.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const callbackUrl = sp.callbackUrl?.startsWith("/") ? sp.callbackUrl : "/dashboard";
  const devMailbox = devMailboxEnabled();
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-6 text-center text-lg font-bold text-slate-900">
        SlotKeep
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="text-2xl">Sign in</span>
          </CardTitle>
          <CardDescription>We&apos;ll email you a link. No password needed.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {sp.error && (
            <Alert variant="error">
              {errorMessage(sp.error)}
              {sp.error === "Configuration" && devMailbox && (
                <>
                  {" "}
                  Local dev: the link is still recorded in the{" "}
                  <a className="underline" href="/dev/mailbox">
                    dev mailbox
                  </a>
                  , and the server log shows why sending failed.
                </>
              )}
            </Alert>
          )}
          <LoginForm callbackUrl={callbackUrl} />
          {googleEnabled && (
            <form action={signInWithGoogle}>
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <Button type="submit" variant="outline" className="w-full">
                Continue with Google
              </Button>
            </form>
          )}
          {demoLoginEnabled() && (
            <div className="border-t border-slate-200 pt-4 text-sm text-slate-700">
              <p className="mb-2 font-medium">Demo accounts</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="secondary">
                  <a href="/api/demo-login?as=owner">Salon owner</a>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <a href="/api/demo-login?as=staff">Salon staff</a>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <a href="/api/demo-login?as=tutor">Tutor owner</a>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
