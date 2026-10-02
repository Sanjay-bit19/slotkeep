import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Check your email" };

export default function CheckEmail() {
  const devMailbox =
    process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_MAILBOX === "true";
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-700">
          <p>A sign-in link is on its way. It works once and expires in 24 hours.</p>
          {devMailbox && (
            <p className="mt-4">
              Local dev: open the{" "}
              <a className="text-brand underline" href="/dev/mailbox">
                dev mailbox
              </a>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
