"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Field } from "./ui/field";
import { Input, Textarea } from "./ui/input";

export interface ServiceFormValues {
  name: string;
  description: string;
  durationMin: number;
  bufferMin: number;
  price: string;
  deposit: string;
  active: boolean;
}

export function ServiceForm({
  action,
  values,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  values: ServiceFormValues;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const err = (k: string) => fe?.[k];
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      {state && !state.ok && (
        <Alert variant="error" className="sm:col-span-2">
          {state.error}
        </Alert>
      )}
      <div className="sm:col-span-2">
        <Field id="name" label="Name" error={err("name")}>
          <Input
            id="name"
            name="name"
            defaultValue={values.name}
            required
            aria-invalid={Boolean(err("name"))}
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field id="description" label="Description (optional)" error={err("description")}>
          <Textarea id="description" name="description" defaultValue={values.description} />
        </Field>
      </div>
      <Field
        id="durationMin"
        label="Duration (minutes)"
        error={err("durationMin")}
        hint="Multiples of 5"
      >
        <Input
          id="durationMin"
          name="durationMin"
          type="number"
          min={5}
          step={5}
          defaultValue={values.durationMin}
          required
        />
      </Field>
      <Field
        id="bufferMin"
        label="Buffer after (minutes)"
        error={err("bufferMin")}
        hint="Cleanup or travel time blocked after each booking"
      >
        <Input
          id="bufferMin"
          name="bufferMin"
          type="number"
          min={0}
          step={5}
          defaultValue={values.bufferMin}
        />
      </Field>
      <Field id="price" label="Price (USD)" error={err("priceCents")}>
        <Input id="price" name="price" inputMode="decimal" defaultValue={values.price} required />
      </Field>
      <Field
        id="deposit"
        label="Deposit (USD)"
        error={err("depositCents")}
        hint="0 to confirm bookings without payment"
      >
        <Input
          id="deposit"
          name="deposit"
          inputMode="decimal"
          defaultValue={values.deposit}
          required
        />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={values.active} className="h-4 w-4" />{" "}
        Bookable online
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save service"}
        </Button>
      </div>
    </form>
  );
}
