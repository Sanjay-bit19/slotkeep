"use client";

import { useActionState, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";

export function OutcomeButtons({
  markCompleted,
  markNoShow,
  showCompleted,
  showNoShow,
}: {
  markCompleted: () => Promise<ActionResult>;
  markNoShow: () => Promise<ActionResult>;
  showCompleted: boolean;
  showNoShow: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {showCompleted && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => start(async () => setResult(await markCompleted()))}
          >
            Mark completed
          </Button>
        )}
        {showNoShow && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => start(async () => setResult(await markNoShow()))}
          >
            Mark no-show
          </Button>
        )}
      </div>
      {result && (
        <Alert variant={result.ok ? "success" : "error"}>
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}

export function CancelBookingForm({
  action,
  refundLabel,
}: {
  action: (prev: ActionResult | null) => Promise<ActionResult>;
  refundLabel: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(action, null);
  if (state?.ok) return <Alert variant="success">{state.message}</Alert>;
  return (
    <div className="flex flex-col gap-3">
      {state && !state.ok && <Alert variant="error">{state.error}</Alert>}
      {!confirming ? (
        <Button variant="destructive" onClick={() => setConfirming(true)}>
          Cancel booking
        </Button>
      ) : (
        <form
          action={formAction}
          className="flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 p-4"
        >
          <p className="text-sm text-red-900">
            Cancel this booking? {refundLabel} The customer will be emailed.
          </p>
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Cancelling..." : "Yes, cancel and refund"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Keep booking
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
