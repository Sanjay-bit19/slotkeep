"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Field } from "./ui/field";
import { Input } from "./ui/input";

export function TimeOffForm({
  action,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <Field id="to-start" label="Start">
        <Input id="to-start" name="start" type="datetime-local" required />
      </Field>
      <Field id="to-end" label="End">
        <Input id="to-end" name="end" type="datetime-local" required />
      </Field>
      <Field id="to-reason" label="Reason (optional)">
        <Input id="to-reason" name="reason" />
      </Field>
      <Button type="submit" disabled={pending}>
        Add time off
      </Button>
      {state && (
        <Alert variant={state.ok ? "success" : "error"} className="sm:col-span-4">
          {state.ok ? state.message : state.error}
        </Alert>
      )}
    </form>
  );
}
