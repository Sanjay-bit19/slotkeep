"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Field } from "./ui/field";
import { Input } from "./ui/input";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface StaffFormValues {
  name: string;
  email: string;
  active: boolean;
  serviceIds: string[];
  /** weekday (1-7) -> [start "HH:MM", end "HH:MM"] */
  hours: Record<number, [string, string] | undefined>;
}

export function StaffForm({
  action,
  values,
  services,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  values: StaffFormValues;
  services: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state && !state.ok && <Alert variant="error">{state.error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Name" error={fe?.name}>
          <Input
            id="name"
            name="name"
            defaultValue={values.name}
            required
            aria-invalid={Boolean(fe?.name)}
          />
        </Field>
        <Field id="email" label="Email (optional)" error={fe?.email}>
          <Input id="email" name="email" type="email" defaultValue={values.email} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={values.active} className="h-4 w-4" />{" "}
        Active (accepts bookings)
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Services offered</legend>
        {services.length === 0 && <p className="text-sm text-slate-600">Create a service first.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="serviceIds"
                value={s.id}
                defaultChecked={values.serviceIds.includes(s.id)}
                className="h-4 w-4"
              />
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-slate-900">Weekly hours</legend>
        <div className="flex flex-col gap-2">
          {DAYS.map((day, i) => {
            const d = i + 1;
            const h = values.hours[d];
            return (
              <div key={d} className="grid grid-cols-[8rem_1fr_1fr] items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={`day-${d}-enabled`}
                    defaultChecked={Boolean(h)}
                    className="h-4 w-4"
                  />
                  {day}
                </label>
                <Input
                  aria-label={`${day} start`}
                  name={`day-${d}-start`}
                  type="time"
                  defaultValue={h?.[0] ?? "09:00"}
                />
                <Input
                  aria-label={`${day} end`}
                  name={`day-${d}-end`}
                  type="time"
                  defaultValue={h?.[1] ?? "17:00"}
                />
              </div>
            );
          })}
        </div>
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save staff member"}
        </Button>
      </div>
    </form>
  );
}
