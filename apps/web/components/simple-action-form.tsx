"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";

/** Generic form wrapper for server actions returning ActionResult; children are the fields. */
export function ActionForm({
  action,
  submitLabel,
  children,
  className,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={formAction} className={className ?? "flex flex-col gap-4"} noValidate>
      {children}
      {fe && (
        <Alert variant="error">
          <ul>
            {Object.entries(fe).map(([k, v]) => (
              <li key={k}>
                {k}: {v[0]}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {state && !fe && (
        <Alert variant={state.ok ? "success" : "error"}>
          {state.ok ? state.message : state.error}
        </Alert>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
