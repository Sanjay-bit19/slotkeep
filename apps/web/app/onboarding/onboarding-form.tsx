"use client";

import { useActionState, useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { createBusiness } from "./actions";

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function OnboardingForm({ timezones, appUrl }: { timezones: string[]; appUrl: string }) {
  const [state, action, pending] = useActionState(createBusiness, null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [tz, setTz] = useState("America/New_York");
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && timezones.includes(detected)) setTz(detected);
  }, [timezones]);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state && !state.ok && !fe && <Alert variant="error">{state.error}</Alert>}
      <Field id="name" label="Business name" error={fe?.name}>
        <Input
          id="name"
          name="name"
          required
          value={name}
          aria-invalid={Boolean(fe?.name)}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <Field
        id="slug"
        label="Booking page address"
        error={fe?.slug}
        hint={`${appUrl}/b/${slug || "your-business"}`}
      >
        <Input
          id="slug"
          name="slug"
          required
          value={slug}
          aria-invalid={Boolean(fe?.slug)}
          aria-describedby="slug-hint"
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
        />
      </Field>
      <Field
        id="timezone"
        label="Time zone"
        error={fe?.timezone}
        hint="Your opening hours are interpreted in this time zone."
      >
        <Select id="timezone" name="timezone" value={tz} onChange={(e) => setTz(e.target.value)}>
          {timezones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="brandColor" label="Brand color" error={fe?.brandColor}>
        <Input
          id="brandColor"
          name="brandColor"
          type="color"
          defaultValue="#4f46e5"
          className="h-10 w-20 p-1"
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create business"}
      </Button>
    </form>
  );
}
