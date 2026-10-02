"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestMagicLink } from "./actions";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, action, pending] = useActionState(requestMagicLink, null);
  const err = state && !state.ok ? state : null;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      {err && !err.fieldErrors && <Alert variant="error">{err.error}</Alert>}
      <Field id="email" label="Email address" error={err?.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(err?.fieldErrors?.email)}
          aria-describedby={err?.fieldErrors?.email ? "email-error" : undefined}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending link..." : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
